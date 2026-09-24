import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Pressable, Text as RNText, type PressableProps } from "react-native";
import { useTheme } from "../appearance";
import { fontFamily, radius, space } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = Omit<PressableProps, "style" | "children" | "onPress"> & {
  variant?: ButtonVariant;
  children: ReactNode;
  // 副作用のあるボタンは全部対象（conventions.md 4節）。戻り値が Promise なら解決・拒否まで再発火を防ぐ
  onPress?: () => void | Promise<void>;
  // 小さな押せる行（投稿カードのハート）。上下 12 の余白で当たり判定 44 を保ち、-8 のマージンで並びの上では
  // 28 しか取らない（react-native-web の Pressable は hitSlop を DOM に反映しないので余白で作る）
  compact?: boolean;
};

export function Button({ variant = "primary", disabled, onPress, children, compact = false, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  // react-native-web の Pressable は環境によって 1 クリックで onPress が 2 回発火する（pointer と click）。
  // 呼び出し側に個別に書かせると必ず書き忘れるので、ガードを Button 自身が持つ（conventions.md 4節）。
  // useRef で同期に判定する（useState だと同じ tick の 2 回目を取りこぼす）
  const isPendingRef = useRef(false);
  // 無効の見た目のため。判定には使わない
  const [isPending, setIsPending] = useState(false);
  const effectiveDisabled = disabled || isPending;

  function reset() {
    isPendingRef.current = false;
    setIsPending(false);
  }

  function handlePress() {
    if (isPendingRef.current || effectiveDisabled || !onPress) return;
    isPendingRef.current = true;
    try {
      const result = onPress();
      if (result instanceof Promise) {
        setIsPending(true);
        // then の第 2 引数で reject も拾う（.finally() だけだと unhandled rejection になる）
        void result.then(reset, reset);
      } else {
        // 同期の処理でも、同じクリックの 2 回目を防ぐため次のマイクロタスクまでガードを保つ（次のクリックには影響しない）
        queueMicrotask(() => {
          isPendingRef.current = false;
        });
      }
    } catch (error) {
      // 同期の onPress が投げてもガードが true のまま固着しない（永久に無反応にしない）
      isPendingRef.current = false;
      throw error;
    }
  }

  return (
    <Pressable
      disabled={effectiveDisabled}
      {...rest}
      onPress={handlePress}
      style={({ pressed }) => {
        const base = {
          paddingVertical: space.md,
          paddingHorizontal: compact ? space.sm : space.xl,
          ...(compact ? { marginVertical: -space.sm, marginLeft: -space.sm } : null),
          borderRadius: radius.pill,
          alignItems: "center" as const,
        };
        if (variant === "primary") {
          return {
            ...base,
            backgroundColor: effectiveDisabled
              ? colors.border
              : pressed
                ? colors.primaryPressed
                : colors.primary,
          };
        }
        if (variant === "secondary") {
          return {
            ...base,
            backgroundColor: pressed ? colors.surfaceTint : colors.surface,
            borderWidth: 1,
            // 枠は primary（border はほぼ地の色で、押せることが伝わりにくい）
            borderColor: colors.primary,
          };
        }
        if (variant === "danger") {
          // 塗りつぶしにせず枠だけ（危険な操作を押しやすくしない。architecture.md 7節）
          return {
            ...base,
            backgroundColor: pressed ? colors.surfaceTint : colors.surface,
            borderWidth: 1,
            borderColor: colors.danger,
          };
        }
        return {
          ...base,
          backgroundColor: pressed ? colors.surfaceTint : "transparent",
        };
      }}
    >
      {/* 文字は weight 600〜700・字間 0.04em（0.64）。共有の Text は字間を持たないので生の Text で組む */}
      <RNText
        style={{
          fontFamily: fontFamily.ja,
          fontSize: compact ? 14 : 16,
          lineHeight: compact ? 20 : 22,
          fontWeight: "700",
          letterSpacing: compact ? 0.56 : 0.64,
          textAlign: "center",
          color: effectiveDisabled
            ? colors.textMuted
            : variant === "primary"
              ? colors.surface
              : variant === "danger"
                ? colors.danger
                : colors.brandInk,
        }}
      >
        {children}
      </RNText>
    </Pressable>
  );
}
