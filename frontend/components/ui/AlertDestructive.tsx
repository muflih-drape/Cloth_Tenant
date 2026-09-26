import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";

interface AlertDestructiveProps {
  heading: string;
  description: string;
}

export function AlertDestructive({
  heading,
  description,
}: AlertDestructiveProps) {
  return (
    <Alert variant="destructive" className="max-w-md">
      <AlertCircleIcon />
      <AlertTitle>{heading}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
