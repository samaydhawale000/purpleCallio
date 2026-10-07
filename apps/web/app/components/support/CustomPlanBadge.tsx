import { Sparkles } from 'lucide-react';
import { Badge } from '../ui/Badge';

/** Marks a support ticket that is a custom-plan conversation. */
export function CustomPlanBadge() {
  return (
    <Badge variant="purple" className="shrink-0">
      <Sparkles size={11} /> Custom plan
    </Badge>
  );
}
