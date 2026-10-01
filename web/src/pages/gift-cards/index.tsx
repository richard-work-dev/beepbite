import { Gift } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { LookupCard } from './components/lookup-card';
import { IssueForm } from './components/issue-form';

/**
 * Gestión de tarjetas de regalo — ruta /gift-cards.
 *
 * Add to src/routes.jsx:
 *   { path: '/gift-cards', element: <GiftCardsPage /> }
 */
export default function GiftCardsPage() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        icon={Gift}
        title="Tarjetas de regalo"
        description="Consultá saldos, recargá, devolvé o emití tarjetas."
      />

      <Tabs defaultValue="lookup">
        <TabsList>
          <TabsTrigger value="lookup">Consultar</TabsTrigger>
          <TabsTrigger value="issue">Emitir</TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="mt-4">
          <LookupCard />
        </TabsContent>

        <TabsContent value="issue" className="mt-4">
          <IssueForm />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
