import { describe, expect, it } from "vitest";
import { resolveRootRoute, type RootRouteInput } from "../lib/root-route";

// architecture.md 7節「ルーティングは、必ずどれか1つが真になる」（Rレビュー
// 指摘R-1・A決定）。014でデモペアを解決できないゲストがどのStack.Protected
// のguardにも入れず、空白画面から再読み込みでしか戻れなくなる不具合を
// 踏んだ。状態の組み合わせを列挙し、どれか1つだけが真になることを固定する

function countTrue(route: { hasCouple: boolean; needsOnboarding: boolean; showAuth: boolean }): number {
  return [route.hasCouple, route.needsOnboarding, route.showAuth].filter(Boolean).length;
}

describe("resolveRootRoute: 未認証（ゲスト含む）は必ずどれか1つが真になる", () => {
  // isDemoViewerはisAuthenticated=falseのときだけ意味を持つ（呼び出し側で
  // !isAuthenticated && isGuestMode として組み立てる）
  const cases: RootRouteInput[] = [
    // 未認証・非デモ（サインイン画面をまだ見ている状態）
    { isAuthenticated: false, isDemoViewer: false, isCoupleLoading: false, hasCoupleData: false, isNeedsOnboardingError: false },
    // ゲスト・デモペアが正常に取れた
    { isAuthenticated: false, isDemoViewer: true, isCoupleLoading: false, hasCoupleData: true, isNeedsOnboardingError: false },
    // ゲスト・デモペアの解決に失敗した（014で踏んだ本体。FORBIDDEN等）
    { isAuthenticated: false, isDemoViewer: true, isCoupleLoading: false, hasCoupleData: false, isNeedsOnboardingError: false },
  ];

  it.each(cases)("isDemoViewer=%s, hasCoupleData=%s のとき、guardが1つだけ真になる", (input) => {
    const route = resolveRootRoute(input);
    expect(countTrue(route)).toBe(1);
  });

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

describe("resolveRootRoute: 認証済みは、couple.getが解決すればどれか1つだけが真になる", () => {
  const cases: RootRouteInput[] = [
    // ペアに所属している
    { isAuthenticated: true, isDemoViewer: false, isCoupleLoading: false, hasCoupleData: true, isNeedsOnboardingError: false },
    // ペアに未所属（NEEDS_ONBOARDING）
    { isAuthenticated: true, isDemoViewer: false, isCoupleLoading: false, hasCoupleData: false, isNeedsOnboardingError: true },
  ];

  it.each(cases)("hasCoupleData=%s, isNeedsOnboardingError=%s のとき、guardが1つだけ真になる", (input) => {
    const route = resolveRootRoute(input);
    expect(countTrue(route)).toBe(1);
  });

  // 既知の受容済みギャップ（014の対象外。認証済み利用者がcouple.getで
  // NEEDS_ONBOARDING以外のエラー〈通信断等〉を受けている間、再試行で
  // じきに解消する一時的な空表示。ゲストのdemoFailedとは別物で、
  // 014はこちらを変えていない）
  it("認証済みでcouple.getがNEEDS_ONBOARDING以外のエラーのときは、どのguardも真にならない（既知・意図的）", () => {
    const route = resolveRootRoute({
      isAuthenticated: true,
      isDemoViewer: false,
      isCoupleLoading: false,
      hasCoupleData: false,
      isNeedsOnboardingError: false,
    });
    expect(countTrue(route)).toBe(0);
  });
});
