import { AwsClient } from "aws4fetch";

// R2 の Workers バインディング（env.BUCKET）は Worker 経由でしかオブジェクトに
// 触れないため、クライアントへ署名付きURLを発行するには R2 の S3互換API を
// SigV4 で自前署名する必要がある（Cloudflare 公式の presigned URL の作り方）。
// 署名だけならネットワークアクセスを伴わない純粋な計算であり、
// この用途に Workers 向けの軽量ライブラリ aws4fetch を使う
export interface R2SignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export const PUT_URL_EXPIRES_SECONDS = 5 * 60;
export const GET_URL_EXPIRES_SECONDS = 60 * 60;

// アップロード後に post.create が env.BUCKET.head() で照合するサイズ上限。
// 署名付き PUT URL（クエリ文字列署名）自体には body サイズを制約する仕組みが無い
// （content-length-range を課せるのは presigned POST policy だが、フォームアップロードで
// 実装が重くなる）。クライアント側の圧縮（1600px/品質0.8）が正常系の主防御であり、
// これは圧縮を経ない・改ざんされたアップロードに対する事後の防御線（architecture.md 6節）
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function endpointFor(config: R2SignConfig, key: string): URL {
  return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`);
}

// 031・security-auditor指摘: 呼び出しのたびに新しいAwsClientを作ると、
// aws4fetchが内部に持つ署名鍵キャッシュ（AwsClient#cache。HMACの導出鍵4連鎖の
// 使い回し）が毎回空になり、SigV4の鍵導出をリクエストのたびにやり直すことになる。
// post.listが1リクエストで複数枚（最大4枚）ぶんcreateGetUrlを呼ぶようになり
// （031）、未認証のデモ閲覧からも到達するreadProcedureのためWorkerのCPU時間が
// 画像枚数に比例して増える。認証情報（accessKeyId/secretAccessKey）ごとに
// AwsClientを1つだけ作り、モジュールスコープ（Workerのアイソレートが生きている
// 間はリクエストをまたいで保持される）で使い回す
const clientCache = new Map<string, AwsClient>();

function clientFor(config: R2SignConfig): AwsClient {
  // R2 API トークン未設定（Cloudflareダッシュボードでの発行がまだ、等）なら
  // その場でエラーにする。空文字のまま署名すると不正な署名のURLを返してしまう
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

// couple_id を含む鍵はサーバだけが組み立てる（architecture.md 5節）。
// クライアントからは imageId のみを受け取り、鍵そのものは入力として受け取らない
// （返す署名付きURLのパスには鍵が含まれるが、安全性は「鍵を入力として受け取らない」
// ことに依存しているのであり、鍵の値自体を秘匿することには依存していない）
export function imageKeyFor(coupleId: string, imageId: string): string {
  return `couples/${coupleId}/posts/${imageId}.jpg`;
}

// プロフィール画像はペアに属さない個人の持ち物のため、couples/... とは
// 別の前綴りにする（019・タスク定義）
const USER_IMAGE_PREFIX = "users/";

export function userImageKeyFor(userId: string, imageId: string): string {
  return `${USER_IMAGE_PREFIX}${userId}/profile/${imageId}.jpg`;
}

// user.image は Google のプロフィール画像URL（外部の直接使えるURL）と、
// 自分でアップロードした画像のR2キー（userImageKeyForの形式）の両方がありうる
// （019）。前綴りで判別し、R2キーのときだけ署名付きGET URLへ解決する。
// この判定はme.get・post.list（authorImage）・stats.get（メンバーのimage）の
// 3箇所で使う（019タスク定義: 「表示名の決め方を2箇所に持たない」と同じ理由で
// 画像の解決も1箇所に集約する）
export async function resolveUserImage(config: R2SignConfig, image: string | null): Promise<string | null> {
  if (!image) return null;
  if (!image.startsWith(USER_IMAGE_PREFIX)) return image;
  return createGetUrl(config, image);
}

// アップロード用の署名付き PUT URL（有効期限5分）。
// 署名付きURL（クエリ文字列署名）は host 以外のヘッダーを署名対象に含めない
// （aws4fetch は content-type を UNSIGNABLE_HEADERS として扱う）ため、
// contentType は署名では強制できない。クライアントが別の Content-Type で
// PUT すること自体は防げないため、実際の強制は post.create が
// env.BUCKET.head() で実体の httpMetadata.contentType を検証する側で行う
// （007 security-auditor 指摘: コメントに「署名対象に含める」と書いていたが誤りだった）
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

// 表示用の署名付き GET URL（有効期限1時間）
export async function createGetUrl(config: R2SignConfig, key: string): Promise<string> {
  const url = endpointFor(config, key);
  url.searchParams.set("X-Amz-Expires", String(GET_URL_EXPIRES_SECONDS));
  const signed = await clientFor(config).sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}
