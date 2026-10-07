'use client';

import { useParams } from 'next/navigation';
import { PlanEditor } from '../../_components/PlanEditor';

export default function EditPlanPage() {
  const { id } = useParams<{ id: string }>();
  return <PlanEditor key={id} planId={id} />;
}
