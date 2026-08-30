// RootNavigator（apps/app/app/_layout.tsx）のガード判定を、Reactの外に
// 出して単体テストできるようにした純関数（Rレビュー指摘R-1を受けて分離）。
// Stack.Protectedの3つのguardのうち、どれか1つは必ずtrueになることを
// テストで固定する。全部falseになると、バナーだけ出た空白画面から
// 再読み込みでしか戻れなくなる（実際に踏んだ不具合）
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
  // デモ閲覧中にcouple.getが失敗した（FORBIDDEN・通信断等）。isGuestModeを
  // 元に戻すきっかけとして呼び出し側が使う
  demoFailed: boolean;
}

export function resolveRootRoute(input: RootRouteInput): RootRoute {
  const { isAuthenticated, isDemoViewer, isCoupleLoading, hasCoupleData, isNeedsOnboardingError } = input;

  const hasCouple = (isAuthenticated || isDemoViewer) && hasCoupleData;
  const needsOnboarding = isAuthenticated && !hasCoupleData && isNeedsOnboardingError;
  // ゲストでの失敗は「一瞬」ではなく「そのまま」なので、認証済み利用者の
  // 通信断（どのguardも上げない意図的な空表示）と同じ扱いにしない
  const demoFailed = isDemoViewer && !isCoupleLoading && !hasCoupleData;
  const showAuth = (!isAuthenticated && !isDemoViewer) || demoFailed;

  return { hasCouple, needsOnboarding, showAuth, demoFailed };
}
