import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";

export const AppLayout = () => {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-16 transition-all duration-300">
        <Outlet />
      </div>
    </div>
  );
};
