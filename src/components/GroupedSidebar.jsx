import {
  Archive,
  BarChart2,
  Grip,
  ImagePlus,
  Layout,
  Mail,
  PackagePlus,
  ScanLine,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  HeartPulse,
  User,
  Users,
} from 'lucide-react';
import { queryClient } from '../lib/queryClient';
import { queryKeys } from '../lib/queryKeys';
import { buildCatalogParams } from '../hooks/useCatalog';
import { importWithRetry } from '../lib/lazyRetry';

const NAV_ITEMS = [
  { id: 'orders', label: 'Order Requests', icon: ShoppingBag },
  { id: 'product-loader', label: 'Product Loader', icon: ScanLine },
  { id: 'image-replace', label: 'Image Replace', icon: ImagePlus },
  { id: 'catalogue', label: 'Product Manager', icon: PackagePlus },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'reorder', label: 'Reorder Grid', icon: Grip },
  { id: 'customers', label: 'Customer Management', icon: Users },
  { id: 'comms', label: 'Email CRM', icon: Mail },
  { id: 'site-content', label: 'Site Content', icon: Star },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'backend-health', label: 'Backend Health', icon: HeartPulse },
  { id: 'pricing', label: 'Pricing', icon: SlidersHorizontal },
  { id: 'team', label: 'Team', icon: User },
];

const CHUNK_PREFETCH = {
  analytics: () => import('./AnalyticsHub'),
  'product-loader': () => import('./ProductLoaderPanel'),
  'image-replace': () => import('./BulkImageReplacePanel'),
  'site-content': () => import('./FeaturedPanel'),
  pricing: () => import('./PricingPanel'),
  reorder: () => import('./ReorderPanel'),
  'backend-health': () => import('./BackendHealthPanel'),
};

function prefetchSection(sectionId) {
  if (sectionId === 'catalogue' || sectionId === 'reorder') {
    queryClient.prefetchQuery({
      queryKey: queryKeys.catalog(buildCatalogParams({ status: 'live', page: 1 })),
      queryFn: async () => {
        // Match the default sort (most-recently-edited first) so this prefetch
        // primes the same cache entry the Product Manager query reads.
        const qs = new URLSearchParams({ status: 'live', page: '1', pageSize: '50', sort: 'updated' });
        const res = await fetch(`/api/catalog?${qs}`);
        return res.json();
      },
    });
  }
  if (sectionId === 'catalogue' || sectionId === 'orders') {
    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboardStats(),
      queryFn: async () => {
        const res = await fetch('/api/dashboard-stats');
        return res.json();
      },
    });
  }
  const chunkLoader = CHUNK_PREFETCH[sectionId];
  if (chunkLoader) importWithRetry(chunkLoader).catch(() => { /* prefetch is best-effort */ });
}

export default function GroupedSidebar({
  activeSection,
  onSelectSection,
  pendingCustomerCount = 0,
  newOrdersCount = 0,
  allowedSectionIds = null,
}) {
  return (
    <nav aria-label="Admin sections">
      {NAV_ITEMS.filter((item) => !allowedSectionIds || allowedSectionIds.includes(item.id)).map((item) => {
        const Icon = item.icon;
        const active = activeSection === item.id;
        const badge = item.id === 'customers' && pendingCustomerCount > 0
          ? { count: pendingCustomerCount, title: 'Pending trade applications' }
          : item.id === 'orders' && newOrdersCount > 0
            ? { count: newOrdersCount, title: 'Orders awaiting payment' }
            : null;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectSection(item.id)}
            onMouseEnter={() => prefetchSection(item.id)}
            onFocus={() => prefetchSection(item.id)}
            className={`adm-nav-btn${active ? ' adm-nav-btn--active' : ''}`}
          >
            <Icon size={17} />
            {item.label}
            {badge && (
              <span className="adm-nav-badge" title={badge.title} aria-label={`${badge.title}: ${badge.count}`}>
                {badge.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export { NAV_ITEMS as NAV_GROUPS };
