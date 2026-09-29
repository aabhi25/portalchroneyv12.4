import ChannelCommentSettings from "@/components/social/ChannelCommentSettings";

export default function FacebookCommentSettings({ embedded = false }: { embedded?: boolean } = {}) {
  return <ChannelCommentSettings channel="facebook" embedded={embedded} />;
}
