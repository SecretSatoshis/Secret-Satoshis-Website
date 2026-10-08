import { notFound } from "next/navigation";
import "../design.css";
import { Concept1 } from "../../../components/agent21/landing/concept1";
import { Concept2 } from "../../../components/agent21/landing/concept2";
import { Concept3 } from "../../../components/agent21/landing/concept3";

// Landing page concepts for review; they never ship to production.
const concepts: Record<string, () => React.ReactElement> = {
  "1": Concept1,
  "2": Concept2,
  "3": Concept3,
};

export default async function DesignPage({
  params,
}: {
  params: Promise<{ concept: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const Concept = concepts[(await params).concept];
  if (!Concept) notFound();
  return <Concept />;
}
