import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const AppLayout = () => {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-16 transition-all duration-300">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
    </div>
  );
};
