import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Pressable, Text as RNText, type PressableProps } from "react-native";
import { colors, fontFamily, radius, space } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<PressableProps, "style" | "children" | "onPress"> & {
  variant?: ButtonVariant;
  children: ReactNode;
  // 送信・認証・作成・削除など副作用のあるボタンは全て対象（conventions.md 4節）。
  // 戻り値が Promise なら、それが解決/拒否するまで再発火を防ぐ
  onPress?: () => void | Promise<void>;
};

export function Button({ variant = "primary", disabled, onPress, children, ...rest }: ButtonProps) {
  // react-native-web の Pressable は環境によって1クリックで onPress が2回発火する
  // （pointer系イベントと click イベントの両方が反応する既知の挙動。PR #22 で
  // 実際に OAuth の state 競合を引き起こした）。呼び出し側に個別実装させると
  // 書き忘れが必ず起きる（005で認可について潰したのと同じ形）ため、
  // ガードを Button 自身に持つ（旧L26。conventions.md 4節）。
  // useRef で同期的に判定する（useState の更新は非同期で、同一tick内の
  // 2回目の発火を取りこぼす）
  const isPendingRef = useRef(false);
  // 見た目の無効化表示用。判定そのものには使わない（上記の理由でuseRefを使う）
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
        // then の第2引数で reject 側も拾う。.finally() だけだと reject した
        // Promise 自体は未処理のままになり unhandled rejection になる
        // （007 security-auditor 指摘）
        void result.then(reset, reset);
      } else {
        // 同期処理は一瞬で終わるが、同一クリック内の2回目発火（上記の
        // react-native-web の既知バグ）を防ぐため、次のマイクロタスクまでは
        // ガードを維持する。次のクリック（次のタスク）には影響しない
        queueMicrotask(() => {
          isPendingRef.current = false;
        });
      }
    } catch (error) {
      // 同期の onPress が例外を投げた場合にガードが true のまま固着し、
      // ボタンが永久に無反応になるのを防ぐ（007 security-auditor 指摘）
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
          paddingHorizontal: space.xl,
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
            // 035: borderからprimaryへ変更（architecture.md 7節）。
            // borderはほぼ地の色で、押せることが伝わりにくかった
            borderColor: colors.primary,
          };
        }
        return {
          ...base,
          backgroundColor: pressed ? colors.surfaceTint : "transparent",
        };
      }}
    >
      {/* 035書体仕様3節: ボタンの文字はweight600〜700・字間0.04em
          （16pt×0.04=0.64）。共有Textはletterspacingを持たないため、
          ここだけ生Textで組む（Buttonの外からはstyleを渡せないまま） */}
      <RNText
        style={{
          fontFamily: fontFamily.ja,
          fontSize: 16,
          lineHeight: 22,
          fontWeight: "700",
          letterSpacing: 0.64,
          textAlign: "center",
          color: effectiveDisabled
            ? colors.textMuted
            : variant === "primary"
              ? colors.surface
              : colors.brandInk,
        }}
      >
        {children}
      </RNText>
    </Pressable>
  );
}
