import ChannelSettings from "@/components/social/ChannelSettings";

export default function FacebookSettings({ embedded = false }: { embedded?: boolean } = {}) {
  return <ChannelSettings channel="facebook" embedded={embedded} />;
}
