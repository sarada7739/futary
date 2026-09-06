import { addDays, isoWeekKey, monthsBefore, todayJst, yearsBefore, jstDayRangeMs } from "@futary/date";

// デモペアのシード（docs/tasks/014-guest-demo.md）。
//
// 【この値は wrangler.toml の DEMO_COUPLE_ID と一致していなければならない】
// crypto.randomUUID() で作らない。実行のたびに id が変わると、
// wrangler.toml の DEMO_COUPLE_ID が古い id を指したままゲストデモが
// FORBIDDEN になる（005 の項目6が正しく効いて拒否される）。R2 の鍵
// couples/{coupleId}/... も変わり、上書きにならず孤児が溜まる
export const DEMO_COUPLE_ID = "demo-couple";
export const DEMO_USER_WOMAN_ID = "demo-user-yui";
export const DEMO_USER_MAN_ID = "demo-user-ren";

const DEMO_USER_WOMAN_NAME = "ゆい";
const DEMO_USER_MAN_NAME = "れん";
const DEMO_USER_WOMAN_EMAIL = "demo-yui@example.com";
const DEMO_USER_MAN_EMAIL = "demo-ren@example.com";

// R2オブジェクトキーの組み立て規則はapps/api/src/lib/r2-signed-url.tsが正
// （imageKeyFor / userImageKeyFor）。packages/db から apps/api には依存できない
// （apps が packages に依存する向きが逆になる）ため、同じ形をここに書き写す。
// 向こうの形式を変えたら、ここも直す
function postImageKey(imageId: string): string {
  return `couples/${DEMO_COUPLE_ID}/posts/${imageId}.jpg`;
}
function userImageKey(userId: string, imageId: string): string {
  return `users/${userId}/profile/${imageId}.jpg`;
}

// packages/db/seed/assets/ に置いた圧縮済み画像（docs/sample/README.mdが出自の記録。
// 長辺1600px/JPEG品質0.8。architecture.md 6節と同じ規則で一度だけ圧縮済み）。
// 実寸を個別に持つ（すべて1536x1024ではない。meetup-1だけ縦長。security-auditor指摘:
// 一律1536x1024と決め打っていたのは誤りだった）
const MEETUP_PHOTOS: Array<{ file: string; width: number; height: number }> = [
  { file: "meetup-1.jpg", width: 1024, height: 1536 },
  { file: "meetup-2.jpg", width: 1536, height: 1024 },
  { file: "meetup-3.jpg", width: 1536, height: 1024 },
  { file: "meetup-4.jpg", width: 1536, height: 1024 },
];
export const DEMO_ASSET_FILES = {
  avatarWoman: "avatar-woman.jpg",
  avatarMan: "avatar-man.jpg",
  meetupPhotos: MEETUP_PHOTOS.map((p) => p.file),
};

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
function sqlString(value: string | null): string {
  return value === null ? "NULL" : `'${escapeSql(value)}'`;
}
function sqlBool(value: boolean): string {
  return value ? "1" : "0";
}

// 「今日」を基準に決定的に組み立てる日付。乱数は一切使わない
// （014タスク定義「日付に乱数を使わない」。meetupの重複を偶然に頼らない）
function noonJstSeconds(date: string): number {
  return Math.floor(jstDayRangeMs(date).fromMs / 1000) + 12 * 60 * 60;
}

const POST_BODIES = [
  "今日は近所を散歩した。風が気持ちよかった。",
  "手作りのカレーを作ってもらった。おいしかった！",
  "映画を観た帰りにカフェに寄った。",
  "何気ない話をたくさんした一日。",
  "お互いの仕事の話をゆっくり聞けた。",
  "夜、ベランダで星を見た。",
  "新しいレシピに挑戦してみた。まあまあの出来。",
  "近くの公園でお弁当を食べた。",
  "ちょっとした喧嘩をしたけど、すぐ仲直りした。",
  "早起きして朝ごはんを一緒に作った。",
  "本屋で気になる本をお互いに紹介し合った。",
  "雨の日はおうちでゆっくり過ごした。",
  "駅前の新しいお店に行ってみた。",
  "何もない普通の一日だったけど、それが良かった。",
  "写真を見返して、思い出話で盛り上がった。",
  "お互いの好きな音楽を聴かせ合った。",
  "散らかった部屋を一緒に片付けた。",
  "近くの神社にお参りに行った。",
  "夜ご飯は簡単に済ませて、映画を観た。",
  "来月の予定について相談した。",
];

interface EventRow {
  id: string;
  date: string;
  title: string;
  kind: "anniversary" | "plan" | "meetup";
  repeatYearly: boolean;
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  isShared: boolean;
}

interface PostImageRow {
  key: string;
  width: number;
  height: number;
}

interface PostRow {
  id: string;
  authorId: string;
  body: string;
  date: string; // created_atの由来（この日の正午JST）
  // 031: position は配列の添字（0..3）。空配列は画像なし
  images: PostImageRow[];
}

interface WishRow {
  id: string;
  title: string;
  note: string; // 028。メモ有り・無しの両方をデモに入れる
  createdBy: string;
  createdAt: number; // 順序が見えるよう明示的に振る（秒。乱数ではない）
  doneAt: number | null;
}

interface MoodRow {
  userId: string;
  date: string;
  level: number;
}

interface AiSummaryRow {
  periodKind: "month" | "week";
  periodKey: string;
  body: string;
  provider: "openai" | "anthropic";
  model: string;
}

export interface DemoSeed {
  coupleId: string;
  users: Array<{ id: string; name: string; email: string; imageKey: string }>;
  datingDate: string;
  events: EventRow[];
  posts: PostRow[];
  reactions: Array<{ postId: string; userId: string }>;
  images: Array<{ key: string; assetFile: string }>;
  wishes: WishRow[];
  moods: MoodRow[];
  aiSummaries: AiSummaryRow[];
}

// 014タスク定義の件数方針:
//   meetup 80〜100件・plan 5〜8件（未来日を含む）・anniversary 3〜5件
//   投稿30〜50件、うち写真付きは目安5〜8件。ただし使える写真が4枚しか無い
//   （security-auditor指摘で1枚除外した。packages/db/seed/README.md参照）ため4件
export function buildDemoSeed(nowMs: number = Date.now()): DemoSeed {
  const today = todayJst(nowMs);
  // 「付き合って○日目」がそれらしい数字になるよう、今日から約1年半（560日）前に置く
  const datingDate = addDays(today, -560);

  const events: EventRow[] = [];

  // --- meetup: 94件。6日おき。時間の有無・種類を混ぜる ---
  const MEETUP_COUNT = 94;
  const MEETUP_INTERVAL_DAYS = 6;
  for (let i = 0; i < MEETUP_COUNT; i++) {
    const date = addDays(datingDate, i * MEETUP_INTERVAL_DAYS);
    const createdBy = i % 2 === 0 ? DEMO_USER_WOMAN_ID : DEMO_USER_MAN_ID;
    const timePattern = i % 3;
    events.push({
      id: `demo-meetup-${i}`,
      date,
      title: "会った日",
      kind: "meetup",
      repeatYearly: false,
      startTime: timePattern === 0 ? "18:00" : timePattern === 2 ? "10:00" : null,
      endTime: timePattern === 0 ? "20:00" : null,
      createdBy,
      isShared: false,
    });
  }

  // --- plan: 6件。未来日を含む。カレンダーに予定が入る様子を見せる ---
  const planDefs: Array<{ offset: number; title: string; start: string | null; end: string | null; shared: boolean }> = [
    { offset: 3, title: "ふたりでカフェ巡り", start: "14:00", end: "16:00", shared: true },
    { offset: 10, title: "映画を観に行く", start: "19:00", end: null, shared: true },
    { offset: 21, title: "温泉旅行", start: null, end: null, shared: true },
    { offset: 35, title: "花火大会", start: "18:30", end: "21:00", shared: false },
    { offset: 60, title: "誕生日プレゼントを選ぶ", start: null, end: null, shared: false },
    { offset: 100, title: "年末年始の予定を決める", start: "20:00", end: null, shared: true },
  ];
  planDefs.forEach((p, i) => {
    events.push({
      id: `demo-plan-${i}`,
      date: addDays(today, p.offset),
      title: p.title,
      kind: "plan",
      repeatYearly: false,
      startTime: p.start,
      endTime: p.end,
      createdBy: i % 2 === 0 ? DEMO_USER_WOMAN_ID : DEMO_USER_MAN_ID,
      isShared: p.shared,
    });
  });

  // --- anniversary: 4件。repeatYearly=true。start_timeは設定できない（CHECK） ---
  events.push({
    id: "demo-anniversary-0",
    date: datingDate,
    title: "付き合った記念日",
    kind: "anniversary",
    repeatYearly: true,
    startTime: null,
    endTime: null,
    createdBy: DEMO_USER_WOMAN_ID,
    isShared: false,
  });
  events.push({
    id: "demo-anniversary-1",
    date: "2020-04-12",
    title: `${DEMO_USER_WOMAN_NAME}の誕生日`,
    kind: "anniversary",
    repeatYearly: true,
    startTime: null,
    endTime: null,
    createdBy: DEMO_USER_MAN_ID,
    isShared: false,
  });
  events.push({
    id: "demo-anniversary-2",
    date: "2020-09-08",
    title: `${DEMO_USER_MAN_NAME}の誕生日`,
    kind: "anniversary",
    repeatYearly: true,
    startTime: null,
    endTime: null,
    createdBy: DEMO_USER_WOMAN_ID,
    isShared: false,
  });
  events.push({
    id: "demo-anniversary-3",
    date: addDays(datingDate, 120),
    title: "初めて花火を見た日",
    kind: "anniversary",
    repeatYearly: true,
    startTime: null,
    endTime: null,
    createdBy: DEMO_USER_MAN_ID,
    isShared: false,
  });

  // --- posts: 40件（14日おき）+ 思い出し用の3マイルストーン = 43件 ---
  const posts: PostRow[] = [];
  const images: Array<{ key: string; assetFile: string }> = [];
  // 031: 1投稿に4枚まで。1・2・3・4枚の投稿をそれぞれ1件以上デモに入れる
  // （タスク定義7節）。写真は MEETUP_PHOTOS の4枚を使い回す。key は
  // 投稿・position ごとに別に生成する（同じ写真を別の投稿・別の位置で
  // 使ってよいが、key（R2オブジェクトキー）は必ず別。post_images.key の
  // UNIQUE制約に沿う）
  let photoCounter = 0;
  function nextPhotoImage(): PostImageRow {
    const photo = MEETUP_PHOTOS[photoCounter % MEETUP_PHOTOS.length];
    if (!photo) throw new Error("MEETUP_PHOTOSが空です");
    photoCounter += 1;
    const imageId = `demo-post-image-${photoCounter}`;
    const key = postImageKey(imageId);
    images.push({ key, assetFile: photo.file });
    return { key, width: photo.width, height: photo.height };
  }

  // グリッド上の特定indexに、1・2・3・4枚をそれぞれ割り当てる
  const imagePostGridCounts: Record<number, number> = { 5: 1, 15: 2, 25: 3, 35: 4 };

  const POST_GRID_COUNT = 40;
  const POST_INTERVAL_DAYS = 14;
  for (let i = 0; i < POST_GRID_COUNT; i++) {
    const date = addDays(datingDate, i * POST_INTERVAL_DAYS);
    const authorId = i % 2 === 0 ? DEMO_USER_WOMAN_ID : DEMO_USER_MAN_ID;
    const body = POST_BODIES[i % POST_BODIES.length] ?? "";
    const imageCount = imagePostGridCounts[i] ?? 0;
    const postImages = Array.from({ length: imageCount }, () => nextPhotoImage());
    posts.push({
      id: `demo-post-${i}`,
      authorId,
      body,
      date,
      images: postImages,
    });
  }

  // memory.get の探索順（1ヶ月前→半年前→1年前）が必ず1件ずつ拾えるように、
  // ぴったりその日付の投稿を用意する（architecture.md 5節）
  posts.push({
    id: "demo-post-milestone-1month",
    authorId: DEMO_USER_WOMAN_ID,
    body: "1ヶ月前の記録。ふたりで撮った写真。",
    date: monthsBefore(today, 1),
    images: [nextPhotoImage()],
  });
  posts.push({
    id: "demo-post-milestone-6months",
    authorId: DEMO_USER_MAN_ID,
    body: "半年前はこんなことを話していた。",
    date: monthsBefore(today, 6),
    images: [],
  });
  posts.push({
    id: "demo-post-milestone-1year",
    authorId: DEMO_USER_WOMAN_ID,
    body: "1年前の今日の記録。",
    date: yearsBefore(today, 1),
    images: [],
  });

  // reactions: 著者以外のパートナーからheartを付ける（5件に1件は付けない。全部に
  // 付くと単調になるため）。自分の投稿に自分で反応する経路は作らない
  const reactions = posts
    .filter((_, i) => i % 5 !== 0)
    .map((post) => ({
      postId: post.id,
      userId: post.authorId === DEMO_USER_WOMAN_ID ? DEMO_USER_MAN_ID : DEMO_USER_WOMAN_ID,
    }));

  images.push({ key: userImageKey(DEMO_USER_WOMAN_ID, "avatar"), assetFile: DEMO_ASSET_FILES.avatarWoman });
  images.push({ key: userImageKey(DEMO_USER_MAN_ID, "avatar"), assetFile: DEMO_ASSET_FILES.avatarMan });

  // --- wishes: 027。「リスト」パネルが押せるようになるため、空のデモは弱い。
  // 未達成・達成済みの両方を、createdAtをずらして入れる（並び順が見えるように）。
  // 実在の店名は入れない（014で写真1枚を落としたのと同じ理由）。
  // 028: メモ有り・無しの両方を混ぜる（設定者2人分は元々分かれている）
  const nowSecondsValue = Math.floor(nowMs / 1000);
  const DAY_SECONDS = 24 * 60 * 60;
  const wishDefs: Array<{
    title: string;
    note: string;
    createdBy: string;
    createdDaysAgo: number;
    done: boolean;
    doneDaysAgo?: number;
  }> = [
    { title: "水族館に行く", note: "夜のライトアップの時間帯がいいらしい", createdBy: DEMO_USER_WOMAN_ID, createdDaysAgo: 3, done: false },
    { title: "新しいカフェを開拓する", note: "", createdBy: DEMO_USER_MAN_ID, createdDaysAgo: 10, done: false },
    { title: "キャンプに行く", note: "テントはまだ持ってない。レンタルできるところを探す", createdBy: DEMO_USER_WOMAN_ID, createdDaysAgo: 25, done: false },
    { title: "遊園地で遊ぶ", note: "", createdBy: DEMO_USER_MAN_ID, createdDaysAgo: 40, done: false },
    { title: "手作りケーキに挑戦する", note: "誕生日に間に合うように", createdBy: DEMO_USER_WOMAN_ID, createdDaysAgo: 70, done: true, doneDaysAgo: 50 },
    { title: "花火大会を見る", note: "", createdBy: DEMO_USER_MAN_ID, createdDaysAgo: 90, done: true, doneDaysAgo: 60 },
    { title: "映画館で新作を観る", note: "続編が公開される前に1作目を見返しておく", createdBy: DEMO_USER_WOMAN_ID, createdDaysAgo: 120, done: true, doneDaysAgo: 15 },
  ];
  const wishes: WishRow[] = wishDefs.map((w, i) => ({
    id: `demo-wish-${i}`,
    title: w.title,
    note: w.note,
    createdBy: w.createdBy,
    createdAt: nowSecondsValue - w.createdDaysAgo * DAY_SECONDS,
    doneAt: w.done && w.doneDaysAgo !== undefined ? nowSecondsValue - w.doneDaysAgo * DAY_SECONDS : null,
  }));

  // --- moods: 029。2人分・3ヶ月ぶん（90日）を決定的に組み立てる。乱数は
  // 使わない（固定パターンをaddDaysだけで日付にする。014「日付に乱数を
  // 使わない」と同じ方針）。空の日を混ぜる（毎日埋まっていると未記録の
  // 見え方が確認できない）。2人の傾向を変える（同じ列が並ぶと、2段ある
  // 意味が見えない。ゆいは総じて高め・れんは起伏が大きい）
  const WOMAN_MOOD_PATTERN: Array<number | null> = [
    3, 4, 4, 5, 4, 3, null, 4, 5, 5, 4, 3, 2, null, 3, 4, 4, 5, 5, 4,
  ];
  const MAN_MOOD_PATTERN: Array<number | null> = [
    2, 3, 2, null, 4, 2, 3, 3, null, 2, 4, 3, 2, 3, null, 4, 3, 2, 3, 2,
  ];
  const MOOD_DAYS = 90;
  const moods: MoodRow[] = [];
  for (let i = 0; i < MOOD_DAYS; i++) {
    const date = addDays(today, -i);
    const womanLevel = WOMAN_MOOD_PATTERN[i % WOMAN_MOOD_PATTERN.length];
    if (womanLevel !== null && womanLevel !== undefined) {
      moods.push({ userId: DEMO_USER_WOMAN_ID, date, level: womanLevel });
    }
    const manLevel = MAN_MOOD_PATTERN[i % MAN_MOOD_PATTERN.length];
    if (manLevel !== null && manLevel !== undefined) {
      moods.push({ userId: DEMO_USER_MAN_ID, date, level: manLevel });
    }
  }

  // --- aiSummaries: 037。先月・先週ぶんを1件ずつ、生成済みとしてシードに
  // 入れる（デモでは実際には生成しない。タスク定義10節）。月・週の両方に
  // 入れるのは、画面の切り替えでどちらを見ても空にならないようにするため
  // （タスク定義自体は「1件」とだけ書いているが、037で月・週の両方を
  // 作ったため両方に置く方が自然と判断した）。
  // 【重要】これは本物のAPIで生成した文章ではない。人が書いた説明文である
  // （artifacts/037/manual-check.md・seed/README.mdに明記）
  const lastMonthDate = monthsBefore(today, 1);
  const lastMonth = lastMonthDate.slice(0, 7);
  const lastWeekDate = addDays(today, -7);
  const lastWeek = isoWeekKey(lastWeekDate);
  const aiSummaries: AiSummaryRow[] = [
    {
      periodKind: "month",
      periodKey: lastMonth,
      body:
        "先月もふたりでたくさんの時間を過ごしました。おいしいごはんを一緒に食べたり、" +
        "近くを散歩したり、何気ない日常の記録が積み重なっています。これからも、" +
        "ふたりだけの思い出を大切にしていってください。",
      provider: "openai",
      model: "gpt-4o-mini",
    },
    {
      periodKind: "week",
      periodKey: lastWeek,
      body:
        "先週はおだやかな1週間でした。何気ない会話や、ちょっとした出来事の記録が" +
        "残っています。今週もふたりらしい時間を過ごしてください。",
      provider: "openai",
      model: "gpt-4o-mini",
    },
  ];

  return {
    coupleId: DEMO_COUPLE_ID,
    users: [
      {
        id: DEMO_USER_WOMAN_ID,
        name: DEMO_USER_WOMAN_NAME,
        email: DEMO_USER_WOMAN_EMAIL,
        imageKey: userImageKey(DEMO_USER_WOMAN_ID, "avatar"),
      },
      {
        id: DEMO_USER_MAN_ID,
        name: DEMO_USER_MAN_NAME,
        email: DEMO_USER_MAN_EMAIL,
        imageKey: userImageKey(DEMO_USER_MAN_ID, "avatar"),
      },
    ],
    datingDate,
    events,
    posts,
    reactions,
    images,
    wishes,
    moods,
    aiSummaries,
  };
}

// 投入の前にデモペアの既存行を消す（014タスク定義）。外部キーの順:
// reactions -> post_images -> posts -> events -> wishes -> moods -> ai_summaries -> invites -> couple_members -> couples -> user。
// 表が増えたときはここへ足す（027でwishes・029でmoods・031でpost_images・037でai_summariesを追加）
function buildDeleteSql(seed: DemoSeed): string[] {
  const userIds = seed.users.map((u) => sqlString(u.id)).join(", ");
  return [
    `DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${sqlString(seed.coupleId)});`,
    `DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${sqlString(seed.coupleId)});`,
    `DELETE FROM posts WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM events WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM wishes WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM moods WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM ai_summaries WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM invites WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM couple_members WHERE couple_id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM couples WHERE id = ${sqlString(seed.coupleId)};`,
    `DELETE FROM user WHERE id IN (${userIds});`,
  ];
}

function buildInsertSql(seed: DemoSeed, nowMs: number): string[] {
  const nowSeconds = Math.floor(nowMs / 1000);
  const statements: string[] = [];

  // couplesが先。couple_membersのFK（couple_id）がcouplesを参照するため
  statements.push(
    `INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES ` +
      `(${sqlString(seed.coupleId)}, ${sqlString(seed.datingDate)}, NULL, 'dating', 1, ${nowSeconds});`,
  );

  for (const [i, u] of seed.users.entries()) {
    // email_verified=0にする。@example.com（RFC 2606予約ドメイン）はGoogle
    // アカウントを作れないため到達不能だが、到達不能性をドメインだけに
    // 依存させない（security-auditor指摘。better-authの検証済みメールでの
    // 自動アカウント連携が万一有効でも、この列で塞ぐ）
    statements.push(
      `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES ` +
        `(${sqlString(u.id)}, ${sqlString(u.name)}, ${sqlString(u.email)}, 0, ${sqlString(u.imageKey)}, ${nowSeconds}, ${nowSeconds});`,
    );
    statements.push(
      `INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES ` +
        `(${sqlString(seed.coupleId)}, ${sqlString(u.id)}, ${i + 1}, ${nowSeconds});`,
    );
  }

  for (const e of seed.events) {
    statements.push(
      `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, start_time, end_time, created_by, is_shared, created_at) VALUES ` +
        `(${sqlString(e.id)}, ${sqlString(seed.coupleId)}, ${sqlString(e.date)}, ${sqlString(e.title)}, ${sqlString(e.kind)}, ` +
        `${sqlBool(e.repeatYearly)}, ${sqlString(e.startTime)}, ${sqlString(e.endTime)}, ${sqlString(e.createdBy)}, ${sqlBool(e.isShared)}, ${nowSeconds});`,
    );
  }

  for (const p of seed.posts) {
    statements.push(
      `INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES ` +
        `(${sqlString(p.id)}, ${sqlString(seed.coupleId)}, ${sqlString(p.authorId)}, ${sqlString(p.body)}, ${noonJstSeconds(p.date)});`,
    );
    p.images.forEach((image, position) => {
      statements.push(
        `INSERT INTO post_images (post_id, position, key, width, height) VALUES ` +
          `(${sqlString(p.id)}, ${position}, ${sqlString(image.key)}, ${image.width}, ${image.height});`,
      );
    });
  }

  for (const r of seed.reactions) {
    statements.push(
      `INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES ` +
        `(${sqlString(r.postId)}, ${sqlString(r.userId)}, 'heart', ${nowSeconds});`,
    );
  }

  for (const w of seed.wishes) {
    statements.push(
      `INSERT INTO wishes (id, couple_id, title, note, created_by, created_at, done_at) VALUES ` +
        `(${sqlString(w.id)}, ${sqlString(seed.coupleId)}, ${sqlString(w.title)}, ${sqlString(w.note)}, ${sqlString(w.createdBy)}, ${w.createdAt}, ${w.doneAt ?? "NULL"});`,
    );
  }

  for (const m of seed.moods) {
    const createdAt = noonJstSeconds(m.date);
    statements.push(
      `INSERT INTO moods (couple_id, user_id, date, level, created_at, updated_at) VALUES ` +
        `(${sqlString(seed.coupleId)}, ${sqlString(m.userId)}, ${sqlString(m.date)}, ${m.level}, ${createdAt}, ${createdAt});`,
    );
  }

  for (const s of seed.aiSummaries) {
    statements.push(
      `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at) VALUES ` +
        `(${sqlString(seed.coupleId)}, ${sqlString(s.periodKind)}, ${sqlString(s.periodKey)}, ${sqlString(s.body)}, ${sqlString(s.provider)}, ${sqlString(s.model)}, 1, ${nowSeconds}, ${nowSeconds});`,
    );
  }

  return statements;
}

export function buildDemoSeedSql(nowMs: number = Date.now()): string {
  const seed = buildDemoSeed(nowMs);
  return [...buildDeleteSql(seed), ...buildInsertSql(seed, nowMs)].join("\n");
}
