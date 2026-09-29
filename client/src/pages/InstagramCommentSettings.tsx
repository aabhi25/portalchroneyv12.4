import ChannelCommentSettings from "@/components/social/ChannelCommentSettings";

export default function InstagramCommentSettings({ embedded = false }: { embedded?: boolean } = {}) {
  return <ChannelCommentSettings channel="instagram" embedded={embedded} />;
}
