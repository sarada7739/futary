// RootNavigator（app/_layout.tsx）のガードの判定を React の外に出した純関数。Stack.Protected の 3 つの guard の
// どれか 1 つは必ず true になることをテストで固定する（全部 false だと、再読み込みでしか戻れない空白になる）。
// 前提（呼び出し側が保証する）: isDemoViewer は isAuthenticated=false のときしか true にならない
// （両方 true の入力では needsOnboarding と showAuth が両方 true になりうる）
export interface RootRouteInput {
  isAuthenticated: boolean;
  isDemoViewer: boolean;
  isCoupleLoading: boolean;
  hasCoupleData: boolean;
  isNeedsOnboardingError: boolean;
}

export interface RootRoute {
  hasCouple: boolean;
  needsOnboarding: boolean;
  showAuth: boolean;
  // デモ閲覧中に couple.get が失敗した（FORBIDDEN・通信断等）。呼び出し側が isGuestMode を戻すきっかけに使う
  demoFailed: boolean;
}

export function resolveRootRoute(input: RootRouteInput): RootRoute {
  const { isAuthenticated, isDemoViewer, isCoupleLoading, hasCoupleData, isNeedsOnboardingError } = input;

  const hasCouple = (isAuthenticated || isDemoViewer) && hasCoupleData;
  const needsOnboarding = isAuthenticated && !hasCoupleData && isNeedsOnboardingError;
  // ゲストの失敗は一瞬でなくそのまま続くので、認証済みの通信断（どの guard も上げない意図的な空表示）と同じにしない
  const demoFailed = isDemoViewer && !isCoupleLoading && !hasCoupleData;
  const showAuth = (!isAuthenticated && !isDemoViewer) || demoFailed;

  return { hasCouple, needsOnboarding, showAuth, demoFailed };
}
