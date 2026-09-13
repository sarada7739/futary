import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { radius, space, Text, useTheme } from "@futary/ui";

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

// 画面の下から出る薄いシート（追加・編集・行のメニューで共用）。040 の want.tsx にあったものを
// 041 でアルバムからも使うため部品に出した（見た目・振る舞いは変えていない）。
// animationType="fade": react-native-web の Modal はアニメーション終了を animationend で検知するため、
// jsdom でも閉じる操作の画面結合テストが書ける（image-viewer.tsx のコメント参照）
export function Sheet({ visible, onClose, children, title }: SheetProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="閉じる"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.35)", justifyContent: "flex-end" }}
      >
        {/* 中身を押しても閉じない */}
        <Pressable onPress={() => {}} style={{ cursor: "auto" } as never}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: space.lg,
              paddingBottom: space.xl,
              gap: space.md,
            }}
          >
            <Text weight="bold">{title}</Text>
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
