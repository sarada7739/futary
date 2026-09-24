import { describe, expect, it } from "vitest";
import { resolveRootRoute, type RootRouteInput } from "../lib/root-route";

// architecture.md「ルーティングは、必ずどれか1つが真になる」。どの Stack.Protected の guard にも
// 入れないと、空白画面から再読み込みでしか戻れなくなる。
//
// 手で並べたケースは並べ忘れに気づけない（conventions.md 6節「0件は範囲とセットでしか意味を
// 持たない」）ので、isAuthenticated × isDemoViewer × isCoupleLoading × hasCoupleData ×
// isNeedsOnboardingError の 2^5=32 通りを総当たりする。ただし:
// - isAuthenticated && isDemoViewer は、呼び出し側（_layout.tsx）が `!isAuthenticated && isGuestMode`
//   で組み立てるので到達しない（root-route.ts の前提）
// - isCoupleLoading=true は、呼び出し側の早期 return がロード画面を出すので 3 つの guard は見ない
//
// 残りの組み合わせでは guard がちょうど 1 つ真になる。例外は「認証済み・NEEDS_ONBOARDING 以外の
// エラー」（hasCoupleData=false かつ isNeedsOnboardingError=false）で、0 個を許す。couple.get は
// retry: false なので、この状態は手で再読み込みするまで止まる。_layout.tsx 側がこの状態を検知して
// 再試行の UI を出す（resolveRootRoute の契約は変えない。016）

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
  // 認証済み・NEEDS_ONBOARDING 以外のエラー（既知・意図的）
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
  // 到達可能な組み合わせが実在する（空配列だと下の it.each が何も確かめずに通る）
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
