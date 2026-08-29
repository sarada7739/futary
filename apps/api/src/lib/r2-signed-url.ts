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

function clientFor(config: R2SignConfig): AwsClient {
  // R2 API トークン未設定（Cloudflareダッシュボードでの発行がまだ、等）なら
  // その場でエラーにする。空文字のまま署名すると不正な署名のURLを返してしまう
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("R2 の署名鍵が設定されていません（R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY）");
  }
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

// couple_id を含む鍵はサーバだけが組み立てる（architecture.md 5節）。
// クライアントからは imageId のみを受け取り、鍵そのものは入力として受け取らない
// （返す署名付きURLのパスには鍵が含まれるが、安全性は「鍵を入力として受け取らない」
// ことに依存しているのであり、鍵の値自体を秘匿することには依存していない）
export function imageKeyFor(coupleId: string, imageId: string): string {
  return `couples/${coupleId}/posts/${imageId}.jpg`;
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
