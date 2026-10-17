import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] w-full flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-purple-50">
            <Compass className="h-6 w-6 text-purple-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900" data-testid="text-not-found-title">We couldn't find that page</h1>
          <p className="mt-2 text-sm text-gray-600">
            The link may be old, or the page may have moved. Everything is in the menu on the left, and "Find a setting" can look it up by name.
          </p>
          <Button asChild className="mt-5" data-testid="button-not-found-home">
            <Link href="/">Go to Home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
