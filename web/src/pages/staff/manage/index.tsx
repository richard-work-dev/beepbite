import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { AlertCircle, ArrowLeft, User, TrendingUp, Shield, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { useStaffDetail } from './hooks/use-staff-detail';
import { StaffList }   from './components/staff-list';
import { ProfileTab }  from './components/profile-tab';
import { PayRatesTab } from './components/pay-rates-tab';
import { SecurityTab } from './components/security-tab';
import { ScheduleTab } from './components/schedule-tab';

export default function StaffManagePage() {
  const { activeLocation } = useAuth();

  const {
    staffList, loadingList, listError, selectedStaff, selectStaff,
    rates, loadingRates, ratesError, createRate,
    shifts, loadingShifts, shiftsError, fetchShifts, createShift, deleteShift,
    resetPassword, resetPin,
  } = useStaffDetail(activeLocation?.id);

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <AlertCircle className="w-12 h-12 mb-3" />
        <p className="text-base font-medium">No hay un local seleccionado</p>
        <p className="text-sm mt-1">Seleccioná un local para gestionar el personal.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card md:h-[calc(100dvh-9rem)] md:flex-row">
      {/* ── left rail ── */}
      <div className={selectedStaff ? 'hidden h-full w-64 shrink-0 overflow-y-auto border-r border-border md:block' : 'h-full w-full shrink-0 overflow-y-auto md:w-64 md:border-r md:border-border'}>
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-base font-semibold text-foreground">Gestión del personal</h1>
          <p className="text-xs text-muted-foreground">{activeLocation.name}</p>
        </div>
        <StaffList
          staffList={staffList}
          loading={loadingList}
          error={listError}
          selectedStaff={selectedStaff}
          onSelect={selectStaff}
        />
      </div>

      {/* ── right pane ── */}
      <div className={selectedStaff ? 'min-w-0 flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6' : 'hidden min-w-0 flex-1 overflow-y-auto p-6 md:block'}>
        {!selectedStaff ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <User className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Seleccioná una persona para ver sus datos</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => selectStaff(null)}
              className="-ml-2 gap-1.5 md:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al personal
            </Button>
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {selectedStaff.first_name} {selectedStaff.last_name}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">Rol: {selectedStaff.role}</p>
            </div>

            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="flex h-auto w-full justify-start gap-0 overflow-x-auto border-b border-primary/15 bg-transparent p-0">
                <TabsTrigger
                  value="profile"
                  className="flex shrink-0 items-center gap-1.5 rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <User className="w-3.5 h-3.5" />
                  Perfil
                </TabsTrigger>
                <TabsTrigger
                  value="pay-rates"
                  className="flex shrink-0 items-center gap-1.5 rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  Remuneración
                </TabsTrigger>
                <TabsTrigger
                  value="security"
                  className="flex shrink-0 items-center gap-1.5 rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Seguridad
                </TabsTrigger>
                <TabsTrigger
                  value="schedule"
                  className="flex shrink-0 items-center gap-1.5 rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Horarios
                </TabsTrigger>
              </TabsList>

              <div className="pt-6">
                <TabsContent value="profile">
                  <ProfileTab staff={selectedStaff} />
                </TabsContent>

                <TabsContent value="pay-rates">
                  <PayRatesTab
                    staff={selectedStaff}
                    rates={rates}
                    loading={loadingRates}
                    error={ratesError}
                    createRate={createRate}
                  />
                </TabsContent>

                <TabsContent value="security">
                  <SecurityTab
                    staff={selectedStaff}
                    resetPassword={resetPassword}
                    resetPin={resetPin}
                  />
                </TabsContent>

                <TabsContent value="schedule">
                  <ScheduleTab
                    staff={selectedStaff}
                    locationId={activeLocation.id}
                    shifts={shifts}
                    loading={loadingShifts}
                    error={shiftsError}
                    fetchShifts={fetchShifts}
                    createShift={createShift}
                    deleteShift={deleteShift}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
