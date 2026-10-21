import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Sites from "@/pages/Sites";
import SiteDetail from "@/pages/SiteDetail";
import Accounts from "@/pages/Accounts";
import AccountDetail from "@/pages/AccountDetail";
import Transactions from "@/pages/Transactions";
import ProgressPayments, { NewProgress } from "@/pages/ProgressPayments";
import ProgressDetail from "@/pages/ProgressDetail";
import Proposals from "@/pages/Proposals";
import Contracts from "@/pages/Contracts";
import Checks from "@/pages/Checks";
import Payments from "@/pages/Payments";
import Reports from "@/pages/Reports";
import AiAssistant from "@/pages/AiAssistant";
import { Users, ChangePassword } from "@/pages/Admin";

function Protected({ children, admin }) {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen flex items-center justify-center"><img src="/logo.png" alt="" className="w-20 h-20 rounded-full animate-pulse" /></div>;
  if (!user) return <Navigate to="/giris" replace />;
  if (admin && user.role !== "yonetici") return <Navigate to="/" replace />;
  return children;
}

function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/giris" element={<LoginRoute />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/santiyeler" element={<Sites />} />
            <Route path="/santiyeler/:id" element={<SiteDetail />} />
            <Route path="/cari/:type" element={<Accounts />} />
            <Route path="/cari/:type/:id" element={<AccountDetail />} />
            <Route path="/islemler" element={<Transactions />} />
            <Route path="/hakedis" element={<ProgressPayments />} />
            <Route path="/hakedis/yeni" element={<NewProgress />} />
            <Route path="/hakedis/:id" element={<ProgressDetail />} />
            <Route path="/teklifler" element={<Proposals />} />
            <Route path="/sozlesmeler" element={<Contracts />} />
            <Route path="/cekler" element={<Checks />} />
            <Route path="/odeme-takvimi" element={<Payments />} />
            <Route path="/raporlar" element={<Reports />} />
            <Route path="/asistan" element={<AiAssistant />} />
            <Route path="/yonetim/kullanicilar" element={<Protected admin><Users /></Protected>} />
            <Route path="/sifre" element={<ChangePassword />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}
