import { useState } from "react";
import { Image, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, colors, radius, Screen, space, Text } from "@futary/ui";
import { compressImage, uploadCompressedImage, type SourceImage } from "../lib/image";
import { useGuestMode } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";

const MAX_BODY_LENGTH = 2000;

export default function ComposeScreen() {
  const router = useRouter();
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const [body, setBody] = useState("");
  const [image, setImage] = useState<SourceImage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestUploadUrl = useMutation(orpc.post.uploadUrl.mutationOptions());
  const createPost = useMutation(
    orpc.post.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.post.list.key() }),
    }),
  );

  const trimmedBody = body.trim();
  // post.create の下限（本文か画像のどちらかは必須。architecture.md 5節）と揃える
  const canSubmit = trimmedBody.length > 0 || image !== null;
  const isSubmitting = requestUploadUrl.isPending || createPost.isPending;

  // 014: FAB・タイムラインの空状態からはゲスト閲覧中にここへ来ないよう
  // ガード済みだが、Webでは /compose を直接開かれる経路が残る
  // （security-auditor指摘）。サーバ側のFORBIDDENが唯一の防御線であることに
  // 変わりはないが、他の画面と同じくログイン導線に差し替える
  if (isGuestMode) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text weight="bold">投稿はログインすると使えます</Text>
          <Button onPress={exitGuestMode}>ログイン</Button>
        </View>
      </Screen>
    );
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;
    setImage({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType });
  }

  // Button 自体が二重発火を防ぐ（conventions.md 4節）。ここでは
  // アップロード〜投稿作成の一連の流れをまとめて1つの onPress にする
  async function handleSubmit() {
    if (!canSubmit) return;
    setErrorMessage(null);

    try {
      let imageId: string | undefined;
      let imageWidth: number | undefined;
      let imageHeight: number | undefined;

      if (image) {
        const compressed = await compressImage(image);
        const uploaded = await uploadCompressedImage(
          (contentType) => requestUploadUrl.mutateAsync({ contentType }),
          compressed,
        );
        imageId = uploaded.imageId;
        imageWidth = uploaded.imageWidth;
        imageHeight = uploaded.imageHeight;
      }

      await createPost.mutateAsync({ body: trimmedBody, imageId, imageWidth, imageHeight });
      router.back();
    } catch {
      setErrorMessage("投稿できませんでした。もう一度お試しください");
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* 画像プレビュー（特に縦長写真）が画面の高さを超えると、下の投稿ボタンが
            画面外に押し出されて押せなくなっていた。スクロール可能にし、
            投稿ボタンは常に押せる位置（画面下部固定）に分離する */}
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="今日の出来事を書く"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_BODY_LENGTH}
            style={{
              minHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.input,
              padding: space.md,
              fontSize: 16,
              color: colors.text,
              textAlignVertical: "top",
            }}
          />

          {image ? (
            <View style={{ gap: space.sm }}>
              <Image
                source={{ uri: image.uri }}
                style={{
                  width: "100%",
                  aspectRatio: image.width && image.height ? image.width / image.height : 1,
                  maxHeight: 400,
                  borderRadius: radius.input,
                }}
                resizeMode="contain"
              />
              <Button variant="ghost" onPress={() => setImage(null)}>
                画像を外す
              </Button>
            </View>
          ) : (
            <Button variant="secondary" onPress={pickImage}>
              画像を選ぶ
            </Button>
          )}

          {errorMessage && <Text color="muted">{errorMessage}</Text>}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg }}>
          {/* モーダルは閉じる導線を自前で持つ（headerShownのヘッダー戻るに
              依存しない。Webでは確実に出るとは限らないため。
              architecture.md「画面の外枠は常に出す」の規則と同じ考え方） */}
          <View style={{ flex: 1 }}>
            <Button variant="ghost" onPress={() => router.back()}>
              キャンセル
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={handleSubmit} disabled={!canSubmit}>
              {isSubmitting ? "投稿中…" : "投稿する"}
            </Button>
          </View>
        </View>
      </View>
    </Screen>
  );
}
