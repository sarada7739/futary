import { describe, expect, it } from "vitest";
import { resolveRootRoute, type RootRouteInput } from "../lib/root-route";

// architecture.md「ルーティングは、必ずどれか1つが真になる」（Rレビュー
// 指摘R-1・A決定）。014でデモペアを解決できないゲストがどのStack.Protected
// のguardにも入れず、空白画面から再読み込みでしか戻れなくなる不具合を
// 踏んだ。
//
// 手で並べたケースは、並べ忘れがあっても気づけない（Rの提案・A決定と
// 同じ理由: conventions.md 6節「0件は範囲とセットでしか意味を持たない」）。
// isAuthenticated × isDemoViewer × isCoupleLoading × hasCoupleData ×
// isNeedsOnboardingError の2^5=32通りを総当たりし、
//
// - isAuthenticated && isDemoViewer が両方trueの組み合わせは、呼び出し側
//   （_layout.tsx）が `!isAuthenticated && isGuestMode` として組み立てる
//   ため到達しない。ここでは検査の対象外にする（root-route.tsの前提コメント参照）
// - isCoupleLoading=true は、呼び出し側の早期return
//   （`(isAuthenticated || isDemoViewer) && isCoupleLoading` でロード画面を
//   出す）が拾うため、resolveRootRouteの3guardは検査しない
//
// 上記2つを除いた到達可能な組み合わせでは、guardがちょうど1つだけ真になる
// ことを固定する。ただし「認証済み・NEEDS_ONBOARDING以外のエラー」
// （hasCoupleData=false かつ isNeedsOnboardingError=false）は既知の
// 受容済みギャップとして0個を許す（014の対象外。014が変えたのは
// isDemoViewer=trueの経路だけで、この組み合わせの振る舞いはそれ以前から
// 変わっていない）。
//
// 【016で訂正】014時点では「再試行でじきに解消する一時的な状態であり、
// ゲストのdemoFailedのように『そのまま』ではない」としていたが、これは
// 誤りだった。couple.getのuseQueryは`retry: false`を指定しており、
// react-query側の自動再試行は無い。つまりこの状態は実際には「じきに
// 解消する」のではなく、利用者が手動で再読み込みするまで止まったままになる
// （Rレビュー全体監査R-3指摘。実際に踏んだ不具合として016のtest-results.md・
// _layout.tsxのコメントに記録済み）。この関数（resolveRootRoute）自体の
// 期待値（0個を許す）は変えていない——ここで直しているのは受容した理由の
// 記述だけで、016では_layout.tsx側にこの状態を検知して再試行UIを出す
// フォールバック描画を追加した（resolveRootRouteの契約や戻り値は変更していない）

const BOOLS = [false, true] as const;

function countTrue(route: { hasCouple: boolean; needsOnboarding: boolean; showAuth: boolean }): number {
  return [route.hasCouple, route.needsOnboarding, route.showAuth].filter(Boolean).length;
}

function isReachable(input: RootRouteInput): boolean {
  if (input.isAuthenticated && input.isDemoViewer) return false; // 呼び出し側の構成上ありえない
  if (input.isCoupleLoading) return false; // 呼び出し側の早期returnが拾う
  return true;
}

function isKnownGap(input: RootRouteInput): boolean {
  // 認証済み・NEEDS_ONBOARDING以外のエラー（既知・意図的。014の対象外）
  return input.isAuthenticated && !input.isDemoViewer && !input.hasCoupleData && !input.isNeedsOnboardingError;
}

function allCombinations(): RootRouteInput[] {
  const combos: RootRouteInput[] = [];
  for (const isAuthenticated of BOOLS) {
    for (const isDemoViewer of BOOLS) {
      for (const isCoupleLoading of BOOLS) {
        for (const hasCoupleData of BOOLS) {
          for (const isNeedsOnboardingError of BOOLS) {
            combos.push({ isAuthenticated, isDemoViewer, isCoupleLoading, hasCoupleData, isNeedsOnboardingError });
          }
        }
      }
    }
  }
  return combos;
}

describe("resolveRootRoute: 到達可能な組み合わせは、既知のギャップを除き必ずguardが1つだけ真になる", () => {
  const combos = allCombinations();
  // 到達可能な組み合わせが実在することを保証する（filterが空配列だと
  // 下のit.eachが何も検査せず成功してしまう）
  const reachable = combos.filter(isReachable);
  expect(reachable.length).toBeGreaterThan(0);

  const reachableTuples = reachable.map(
    (r) =>
      [r.isAuthenticated, r.isDemoViewer, r.isCoupleLoading, r.hasCoupleData, r.isNeedsOnboardingError] as const,
  );

  it.each(reachableTuples)(
    "auth=%s demo=%s loading=%s hasData=%s needsOnb=%s",
    (isAuthenticated, isDemoViewer, isCoupleLoading, hasCoupleData, isNeedsOnboardingError) => {
      const input = { isAuthenticated, isDemoViewer, isCoupleLoading, hasCoupleData, isNeedsOnboardingError };
      const route = resolveRootRoute(input);
      const expected = isKnownGap(input) ? 0 : 1;
      expect(countTrue(route)).toBe(expected);
    },
  );

  it("既知のギャップは「認証済み・NEEDS_ONBOARDING以外のエラー」の1通りだけである", () => {
    const gaps = reachable.filter(isKnownGap);
    expect(gaps).toEqual([
      { isAuthenticated: true, isDemoViewer: false, isCoupleLoading: false, hasCoupleData: false, isNeedsOnboardingError: false },
    ]);
  });
});

describe("resolveRootRoute: ゲスト固有の振る舞い", () => {
  it("ゲストでcouple.getが失敗するとdemoFailedが立ち、showAuthだけが真になる", () => {
    const route = resolveRootRoute({
      isAuthenticated: false,
      isDemoViewer: true,
      isCoupleLoading: false,
      hasCoupleData: false,
      isNeedsOnboardingError: false,
    });
    expect(route.demoFailed).toBe(true);
    expect(route.showAuth).toBe(true);
    expect(route.hasCouple).toBe(false);
    expect(route.needsOnboarding).toBe(false);
  });

  it("ロード中（isCoupleLoading=true）のゲストはdemoFailedにならない（呼び出し側がロード画面を別に出すため、ここでは判定しない）", () => {
    const route = resolveRootRoute({
      isAuthenticated: false,
      isDemoViewer: true,
      isCoupleLoading: true,
      hasCoupleData: false,
      isNeedsOnboardingError: false,
    });
    expect(route.demoFailed).toBe(false);
  });
});
