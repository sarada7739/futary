import { AwsClient } from "aws4fetch";

// クライアントへ渡す署名付き URL は、R2 の S3 互換 API を SigV4 で署名して作る
// （env.BUCKET は Worker からしか触れない）。署名はネットワークを伴わない計算で、aws4fetch を使う
export interface R2SignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export const PUT_URL_EXPIRES_SECONDS = 5 * 60;
export const GET_URL_EXPIRES_SECONDS = 60 * 60;
// 保存用（attachment 付き）の GET URL は押した瞬間にしか要らないので、表示用（1 時間）より短い（architecture.md 6節）
export const DOWNLOAD_URL_EXPIRES_SECONDS = 5 * 60;

// アップロード後に head() で照合するサイズ上限。署名付き PUT URL は body のサイズを制約できない
// （できるのは presigned POST policy で、重い）。主な防御はクライアントの圧縮で、これは圧縮を経ない・
// 改ざんされたアップロードへの事後の防御線（architecture.md 6節）
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function endpointFor(config: R2SignConfig, key: string): URL {
  return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`);
}

// AwsClient は認証情報ごとに 1 つ作ってモジュールスコープで使い回す（アイソレートが生きている間は
// リクエストをまたいで残る）。毎回作ると内部の署名鍵キャッシュが空になり、未認証でも届く一覧で
// 画像の枚数だけ鍵の導出をやり直して CPU 時間が増える
const clientCache = new Map<string, AwsClient>();

function clientFor(config: R2SignConfig): AwsClient {
  // トークン未設定ならその場でエラーにする（空文字のまま署名すると壊れた URL を返す）
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("R2 の署名鍵が設定されていません（R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY）");
  }
  const cacheKey = `${config.accessKeyId}:${config.secretAccessKey}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  clientCache.set(cacheKey, client);
  return client;
}

// couple_id を含む鍵はサーバだけが組み立て、クライアントからは imageId だけを受け取る。
// 安全性は「鍵を入力として受け取らない」ことに依り、鍵の値を秘匿することには依らない
// （返す URL のパスには鍵が含まれる。architecture.md 5節）
export function imageKeyFor(coupleId: string, imageId: string): string {
  return `couples/${coupleId}/posts/${imageId}.jpg`;
}

// ほしいものの画像。posts/ と分ける（退会時に接頭辞で消す対象が分かる）。拡張子は 3 種
// （自動取得は jpeg/png/webp、手で付けるのは jpg）。Content-Type は httpMetadata から返る
export function wantImageKeyFor(coupleId: string, imageId: string, extension: "jpg" | "png" | "webp"): string {
  return `${wantImagePrefixFor(coupleId)}${imageId}.${extension}`;
}

export function wantImagePrefixFor(coupleId: string): string {
  return `couples/${coupleId}/wants/`;
}

// アルバムに直接上げた写真。posts/・wants/ と分ける（退会・孤児の回収で対象が分かる。architecture.md 6節）
export function albumImageKeyFor(coupleId: string, imageId: string): string {
  return `${albumImagePrefixFor(coupleId)}${imageId}.jpg`;
}

export function albumImagePrefixFor(coupleId: string): string {
  return `couples/${coupleId}/albums/`;
}

// 鍵の末尾の imageId（保存するファイル名に使う）。鍵はサーバが組み立てた {prefix}{imageId}.jpg だけ
export function imageIdOfKey(key: string): string {
  const basename = key.slice(key.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

// プロフィール画像はペアに属さない個人の持ち物なので couples/... とは別の接頭辞
const USER_IMAGE_PREFIX = "users/";

export function userImageKeyFor(userId: string, imageId: string): string {
  return `${USER_IMAGE_PREFIX}${userId}/profile/${imageId}.jpg`;
}

// user.image は Google の外部 URL か、自分で上げた画像の R2 キー。接頭辞で見分け、R2 キーだけを
// 署名付き URL にする。解決はここ 1 箇所（2 箇所に持たない。019）
export async function resolveUserImage(config: R2SignConfig, image: string | null): Promise<string | null> {
  if (!image) return null;
  if (!image.startsWith(USER_IMAGE_PREFIX)) return image;
  return createGetUrl(config, image);
}

// アップロード用の署名付き PUT URL（5 分）。クエリ文字列署名は host 以外のヘッダーを署名に含めない
// （aws4fetch は content-type を署名しない）ので、contentType は強制できない。実際の強制は
// 受け取る側が head() で実体の httpMetadata.contentType を見て行う
export async function createPutUrl(config: R2SignConfig, key: string, contentType: string): Promise<string> {
  const url = endpointFor(config, key);
  url.searchParams.set("X-Amz-Expires", String(PUT_URL_EXPIRES_SECONDS));
  const signed = await clientFor(config).sign(url.toString(), {
    method: "PUT",
    headers: { "content-type": contentType },
    aws: { signQuery: true },
  });
  return signed.url;
}

// 保存用の署名付き GET URL（5 分）。response-content-disposition をクエリに足してから署名する
// （signQuery はクエリ全部を署名するので、URL を持つ人も filename を書き換えられない。変えると 403。
// artifacts/041/download.md）。filename はサーバが組み立てた ASCII だけ（引用符・改行を含まない）
export async function createDownloadUrl(config: R2SignConfig, key: string, filename: string): Promise<string> {
  const url = endpointFor(config, key);
  url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_EXPIRES_SECONDS));
  url.searchParams.set("response-content-disposition", `attachment; filename="${filename}"`);
  const signed = await clientFor(config).sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

// 表示用の署名付き GET URL（1 時間）
export async function createGetUrl(config: R2SignConfig, key: string): Promise<string> {
  const url = endpointFor(config, key);
  url.searchParams.set("X-Amz-Expires", String(GET_URL_EXPIRES_SECONDS));
  const signed = await clientFor(config).sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}
