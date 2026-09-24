import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { radius, space, Text, useTheme } from "@futary/ui";

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  // 省略すると題を描かない（中身が自分で組むとき）
  title?: string;
  children: ReactNode;
};

// 画面の下から出る薄いシート（追加・編集・行のメニューで共用）。
// animationType="fade": react-native-web の Modal はアニメーションの終わりを animationend で見る（image-viewer.tsx）
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
            {title !== undefined && <Text weight="bold">{title}</Text>}
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
