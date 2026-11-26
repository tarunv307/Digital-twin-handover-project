import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TwinProvider } from "./store/twinStore";
import { LandingPage } from "./pages/LandingPage";
import { CompanyPage } from "./pages/CompanyPage";
import { RegionPage } from "./pages/RegionPage";
import { FactoryPage } from "./pages/FactoryPage";
import { LineJourneyPage } from "./pages/LineJourneyPage";
import { MachineDetailPage } from "./pages/MachineDetailPage";
import { MachineHandoverPage } from "./pages/MachineHandoverPage";
import { SimulationPage } from "./pages/SimulationPage";
import { EventsPage } from "./pages/EventsPage";
import { OperatorDashboardPage } from "./pages/OperatorDashboardPage";
import { MyReportsPage } from "./pages/MyReportsPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { QrPassportPage } from "./pages/QrPassportPage";
import { ReportsPage } from "./pages/ReportsPage";

export function App() {
  return (
    <TwinProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/digital-twin" element={<CompanyPage />} />
          <Route path="/digital-twin/operator" element={<OperatorDashboardPage />} />
          <Route path="/digital-twin/my-reports" element={<MyReportsPage />} />
          <Route path="/digital-twin/users" element={<UserManagementPage />} />
          <Route path="/digital-twin/analytics" element={<AnalyticsPage />} />
          <Route path="/digital-twin/reports" element={<ReportsPage />} />
          <Route path="/digital-twin/region/:regionId" element={<RegionPage />} />
          <Route path="/digital-twin/factory/:factoryId" element={<FactoryPage />} />
          <Route path="/digital-twin/line/:lineId" element={<LineJourneyPage />} />
          <Route path="/digital-twin/machine/:machineId" element={<MachineDetailPage />} />
          <Route path="/digital-twin/machine/:machineId/handover" element={<MachineHandoverPage />} />
          <Route path="/digital-twin/qr/:qrToken" element={<QrPassportPage />} />
          <Route path="/digital-twin/simulation" element={<SimulationPage />} />
          <Route path="/digital-twin/events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/digital-twin" replace />} />
        </Routes>
      </BrowserRouter>
    </TwinProvider>
  );
}

export default App;
