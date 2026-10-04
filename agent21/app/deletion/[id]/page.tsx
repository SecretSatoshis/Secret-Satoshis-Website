import { DeletionStatus } from "../../../components/agent21/deletion-status";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeletionStatus id={id} />;
}
