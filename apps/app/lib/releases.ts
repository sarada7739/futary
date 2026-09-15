// 043: リリース履歴。データはこの配列だけ（表も手続きも無い。タスク定義 0節 #1）。
// 版の番号はこの一覧の中だけの番号（v1.0.0 = 016 の公開。機能を足すごとに minor、
// アルバムは 2.0.0。package.json の version とは連動しない。0節 #3）。
// 利用者に見える機能を足すタスクは、同じ PR でここに 1 項目足す（conventions.md 8節）。
// 文言は A がタスク定義に書く。日付は実装 PR が main に入った日（JST。git log --first-parent）
export type Release = {
  version: string; // "2.0.0"
  date: string; // "2026-09-14"（YYYY-MM-DD。JST）
  title: string; // "アルバム機能を追加"
  items: string[]; // 箇条書き。1〜5 行。各 40 文字まで
  route?: string; // "/album"。あれば「新機能を見る →」と、お知らせシートの「使ってみる」の行き先
  emoji?: string; // 題名の末尾に付ける絵文字（初回リリースの 🎉 だけ）
};

// 新しい順。先頭が最新。LATEST_VERSION は先頭から取る（2 箇所に持たない）
export const RELEASES: readonly Release[] = [
  {
    version: "3.1.0",
    date: "2026-09-15",
    title: "プレミアムプランを始めました",
    items: ["写真を 5 万枚まで保存できます", "月額と年額から選べます"],
    route: "/premium",
  },
  {
    version: "3.0.0",
    date: "2026-09-15",
    title: "Nisoine になりました",
    items: ["アプリの名前が Nisoine になりました", "見た目と機能はそのままです"],
  },
  {
    version: "2.3.0",
    date: "2026-09-15",
    title: "タイムラインをすっきりさせました",
    items: ["投稿の余白を詰めて、一覧で多く見えるようにしました", "縦長の写真は高さを揃えました"],
    route: "/timeline",
  },
  {
    version: "2.2.0",
    date: "2026-09-14",
    title: "アルバムの写真をまとめて持ち出せます",
    items: ["アルバムの写真を ZIP でまとめて保存できます", "説明文も一緒に入ります"],
    route: "/album",
  },
  {
    version: "2.0.0",
    date: "2026-09-14",
    title: "アルバム機能を追加",
    items: [
      "写真をアルバムにまとめられるようになりました",
      "「タイムライン」には投稿した写真が自動で集まります",
      "旅行やイベントごとにアルバムを作れます",
      "写真は 1 枚ずつも、選んでまとめても保存できます",
    ],
    route: "/album",
  },
  {
    version: "1.9.0",
    date: "2026-09-13",
    title: "ほしいものを追加",
    items: ["自分のほしいものを相手に伝えられます", "URL を貼ると画像が付きます", "手に入れたら印を付けられます"],
    route: "/want",
  },
  {
    version: "1.8.0",
    date: "2026-09-13",
    title: "ホワイトの外観を追加",
    items: ["マイページで外観をピンクとホワイトから選べます"],
    route: "/profile",
  },
  {
    version: "1.7.0",
    date: "2026-09-06",
    title: "AIまとめを追加",
    items: ["ふたりの 1 か月を AI が短くまとめます", "ふたりとも同意したときだけ使えます"],
    route: "/ai-summary",
  },
  {
    version: "1.6.0",
    date: "2026-09-05",
    title: "見た目を整えました",
    items: ["ホームや各画面の見た目を作り込みました", "削除など取り消せない操作の色を分けました"],
  },
  {
    version: "1.5.0",
    date: "2026-09-04",
    title: "写真を 4 枚まで",
    items: ["1 つの投稿に写真を 4 枚まで付けられます", "横に送って見られます", "アプリのアイコンを新しくしました"],
    route: "/timeline",
  },
  {
    version: "1.4.0",
    date: "2026-09-02",
    title: "気分の記録を追加",
    items: ["今日の気分を 5 段階で残せます", "ふたりの気分を月の表で見られます"],
    route: "/mood",
  },
  {
    version: "1.3.0",
    date: "2026-09-01",
    title: "行きたい場所・食べたいものリストを追加",
    items: ["行きたい場所・食べたいものをふたりで書けます", "メモを付けられます", "行けたら達成にできます"],
    route: "/list",
  },
  {
    version: "1.2.0",
    date: "2026-09-01",
    title: "アカウントまわりを整えました",
    items: ["退会できるようになりました", "招待コードを発行し直せます", "付き合った日はあとから設定できます"],
    route: "/profile",
  },
  {
    version: "1.1.0",
    date: "2026-08-31",
    title: "予定に時刻を",
    items: ["予定に開始・終了の時刻を付けられます", "相手が入れた予定も見られます", "日付は 8 桁で入力できます"],
    route: "/calendar",
  },
  {
    version: "1.0.0",
    date: "2026-08-31",
    title: "futary リリース",
    items: [
      "ふたりだけの SNS がはじまりました",
      "タイムライン・カレンダー・思い出・統計",
      "写真は全画面で見られます",
      "ログインしなくてもデモで試せます",
    ],
    emoji: "🎉",
  },
];

export const LATEST_VERSION: string = RELEASES[0]!.version;
export const LATEST_RELEASE: Release = RELEASES[0]!;

// 一覧・シートの表示用（"2026-09-14" → "2026.09.14"）。暦の解釈は無いので文字列の置き換えだけ
// （new Date を使わない。eslint の no-restricted-syntax）
export function formatReleaseDate(date: string): string {
  return date.replaceAll("-", ".");
}
