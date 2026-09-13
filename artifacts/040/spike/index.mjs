// 040 段階0: 計測用の使い捨て Worker。
//   GET /?url=<商品URL>&ua=<User-Agent 文字列>[&raw=1]
// 指定 URL を GET し、先頭 512KB から og:title / og:image を正規表現で拾う。
// og:image が取れたら画像も GET して Content-Type と大きさを見る（1MB の上限に収まるか）。
// raw=1 のときは HTML の先頭 512KB をそのまま返す（テストのフィクスチャ用）。
// 本番のコードではない。security-requirements 6節の検査（IP リテラル等）はここでは省く。

const HEAD_LIMIT = 512 * 1024;
const IMAGE_LIMIT = 1024 * 1024;

function pickMeta(html, prop) {
  // <meta property="og:xxx" content="..."> と、属性順が逆のものを両方拾う
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m ? m[1] : null;
}

async function readUpTo(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(total, limit));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, buf.byteLength - off);
    buf.set(c.subarray(0, n), off);
    off += n;
    if (off >= buf.byteLength) break;
  }
  return { bytes: buf, truncated: total >= limit };
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    const target = u.searchParams.get("url");
    const ua = u.searchParams.get("ua") ?? "futary-link-preview/1";
    const raw = u.searchParams.get("raw") === "1";
    // 切り分け用。既定 5 秒（本番の要件）。楽天の遅さを見るときだけ延ばす
    const timeoutMs = Number(u.searchParams.get("timeoutMs") ?? 5000);
    // 切り分け用。既定 512KB（本番の要件）。画像ブロックの位置を測るときだけ広げる
    const headLimit = Number(u.searchParams.get("headLimit") ?? HEAD_LIMIT);
    if (!target) return new Response("url が要る", { status: 400 });

    const started = Date.now();
    const out = { target, ua, status: null, finalUrl: null, contentType: null, headBytes: 0, truncated: false,
      ogTitle: null, ogImage: null, metaTitle: null, twitterImage: null, amazonOldHires: null, amazonDynamicFirst: null, pickedImage: null, image: null, elapsedMs: 0, error: null };
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(target, {
        redirect: "follow",
        signal: ctl.signal,
        headers: {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en;q=0.8",
        },
      });
      out.status = res.status;
      out.finalUrl = res.url;
      out.contentType = res.headers.get("content-type");
      const { bytes, truncated } = await readUpTo(res, headLimit);
      clearTimeout(timer);
      out.headBytes = bytes.byteLength;
      out.truncated = truncated;
      // 切り分け用。charset=1 のとき Content-Type の charset で復号する（楽天は EUC-JP）
      let charset = "utf-8";
      if (u.searchParams.get("charset") === "1") {
        const m = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "");
        if (m) charset = m[1];
      }
      let html;
      try {
        html = new TextDecoder(charset, { fatal: false }).decode(bytes);
        out.charsetUsed = charset;
      } catch (e) {
        out.charsetUsed = `${charset} は使えない: ${String(e)}`;
        html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      if (raw) {
        return new Response(bytes, { headers: { "content-type": "text/plain; charset=utf-8", "x-status": String(res.status), "x-final-url": res.url } });
      }
      out.ogTitle = pickMeta(html, "og:title");
      out.ogImage = pickMeta(html, "og:image");
      // 予備（OGP が無い店向け。Amazon は og:* を出さない）
      out.metaTitle = pickMeta(html, "title");
      out.twitterImage = pickMeta(html, "twitter:image");
      const oldHires = html.match(/data-old-hires="([^"]+)"/);
      out.amazonOldHires = oldHires ? oldHires[1] : null;
      const dyn = html.match(/id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"/);
      out.amazonDynamicFirst = dyn ? dyn[1].replace(/&quot;/g, '"').match(/"(https:[^"]+)"/)?.[1] ?? null : null;
      out.pickedImage = out.ogImage ?? out.twitterImage ?? out.amazonOldHires ?? out.amazonDynamicFirst ?? null;
      if (out.pickedImage) {
        const ictl = new AbortController();
        const itimer = setTimeout(() => ictl.abort(), 5000);
        try {
          const ires = await fetch(new URL(out.pickedImage, res.url).toString(), {
            redirect: "follow", signal: ictl.signal, headers: { "User-Agent": ua, "Accept": "image/*" },
          });
          const { bytes: ib, truncated: it } = await readUpTo(ires, IMAGE_LIMIT + 1);
          out.image = { status: ires.status, contentType: ires.headers.get("content-type"),
            bytes: ib.byteLength, overLimit: it, head: Array.from(ib.subarray(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ") };
        } catch (e) {
          out.image = { error: String(e) };
        } finally {
          clearTimeout(itimer);
        }
      }
    } catch (e) {
      out.error = String(e);
    }
    out.elapsedMs = Date.now() - started;
    return Response.json(out);
  },
};
