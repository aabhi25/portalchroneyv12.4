import ChannelSettings from "@/components/social/ChannelSettings";

export default function InstagramSettings({ embedded = false }: { embedded?: boolean } = {}) {
  return <ChannelSettings channel="instagram" embedded={embedded} />;
}
