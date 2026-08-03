Warning: truncated output (original token count: 47527)
Total output lines: 3861

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Bot,
  MessageCircle,
  Building2,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  DollarSign,
  Download,
  Eye,
  FileDown,
  Home,
  Plus,
  Globe,
  Grip,
  Image,
  ImagePlus,
  Layout,
  Loader2,
  Lock,
  Megaphone,
  Upload,
  Mail,
  MapPin,
  Menu,
  PackagePlus,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Trash2,
  TrendingUp,
  User,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
// xlsx is loaded on demand in the export handlers — keeps it out of the main bundle
import {
  bulkArchiveProducts,
  createProduct,
  fetchAdminProductsPage,
  fetchAllProductsAdmin,
  fetchCatalogArchiveCount,
  fetchDistinctCategories,
  invalidateAdminCache,
  invalidateProductCache,
  fetchProductAvailability,
  setLiveTaxonomyTree,
  setNewArrival,
  setProductAvailability,
  setToOrder,
  updateProduct,
  uploadDormantImage,
} from '../lib/products';
import {
  categoryLabelFromTree,
  countSubcategoryProducts,
  createCategory,
  createSubcategory,
  deleteTaxonomyNode,
  fetchTaxonomy,
  fetchCategoryProductCounts,
  flattenSubcategories,
  renameTaxonomyNode,
  replaceFullTaxonomy,
  subcategoryOptionsFromTree,
} from '../lib/taxonomyAdmin';
import { approveCustomer, deleteCustomer, fetchCustomersPage, fetchProtoActiveCustomersPage, updateProtoActiveCustomer, updateCustomerAdmin, deleteProtoActiveCustomer, deleteAllProtoActiveCustomers, importProtoActiveCustomers, sendCustomerEmailBroadcast, fetchCrmContactsPage } from '../lib/customers';
import { BUSINESS_TYPES } from '../lib/businessTypes';
import { supabase } from '../lib/supabase';
import { buildOrderNoteSections, createEmailOrderItems, generateOrderPdfBase64, buildEmailItemsFromOrder, base64ToBlob, resolveCustomerOrderPricing, deriveAutoNotesFromItems } from '../lib/orderDocuments';
import { displayOrderNumber, buildFulfillmentUrl } from '../lib/orderNumber';
import { fetchPresaleInvoices, uploadPresaleInvoice } from '../lib/presaleInvoice';
import { fetchConfirmationSent, markConfirmationSent, fetchPaymentRecords, uploadPop, setPaymentStatus } from '../lib/orderPayment';
import { deleteOrderAdmin, fetchOrdersPage, updateOrderAdmin, advanceOrderWorkflow } from '../lib/orders';
import { orderMatchesTab, normalizeOrderStatus, getWorkflowAdvanceOptions, isOrderConfirmationSent } from '../lib/orderStatus';
import OrderWorkflowBadge from '../components/OrderWorkflowBadge';
import { fetchFulfillmentUsers, loadActiveUserId } from '../lib/fulfillmentUsers';
import { isVictorSender, CUSTOMER_SEND_FORBIDDEN, PAYMENT_RECEIVED_FORBIDDEN } from '../lib/fulfillmentAuth';
import { errorFromJson } from '../lib/apiError';
import { formatWebsitePrice } from '../lib/pricing';
import { fetchSpecials, saveSpecials } from '../lib/specials';
import TaxonomyModals from '../components/TaxonomyModals';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import PlacementsEditor from '../components/PlacementsEditor';
import AdminSelect from '../components/AdminSelect';
import ComingSoonPanel from '../components/ComingSoonPanel';
import OrderEmailNotify from '../components/OrderEmailNotify';
import ProductManagerEngine from '../components/ProductManagerEngine';
import GroupedSidebar, { NAV_GROUPS } from '../components/GroupedSidebar';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { queryClient } from '../lib/queryClient';
import { queryKeys } from '../lib/queryKeys';
import { dispatchAdminRefresh } from '../lib/adminRefresh';
import { lazyRetry } from '../lib/lazyRetry';
import SellingUnitField from '../components/SellingUnitField';
import CustomerApplicationDetails from '../components/CustomerApplicationDetails';
import CustomerIqPanel from '../components/CustomerIqPanel';
import { businessSearchUrl, traderVerificationSummary } from '../lib/traderVerification';

// Section panels — lazy-loaded so the initial admin bundle only ships the
// default section (Product Manager). Each lazy chunk is fetched on demand
// when the admin clicks a nav item.
const AnalyticsHub = lazyRetry(() => import('../components/AnalyticsHub'));
const ProductLoaderPanel = lazyRetry(() => import('../components/ProductLoaderPanel'));
const BulkImageReplacePanel = lazyRetry(() => import('../components/BulkImageReplacePanel'));
const BannerPanel = lazyRetry(() => import('../components/BannerPanel'));
const FeaturedPanel = lazyRetry(() => import('../components/FeaturedPanel'));
const SpecialsPanel = lazyRetry(() => import('../components/SpecialsPanel'));
const PricingPanel = lazyRetry(() => import('../components/PricingPanel'));
const ReorderPanel = lazyRetry(() => import('../components/ReorderPanel'));
const OrdersWorkspacePanel = lazyRetry(() => import('../components/OrdersWorkspacePanel'));
const BackendHealthPanel = lazyRetry(() => import('../components/BackendHealthPanel'));
const HermesPanel = lazyRetry(() => import('../components/HermesPanel'));
const ProductIntelligencePanel = lazyRetry(() => import('../components/ProductIntelligencePanel'));
const BuyingPanel = lazyRetry(() => import('../components/BuyingPanel'));

function orderWorkspaceIdFromPath() {
  const match = window.location.pathname.match(/^\/(?:apollo\/)?orders\/workspace\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function SectionSuspenseFallback({ label = 'Loading…' }) {
  return (
    <div className="adm-panel" style={{ padding: 24, color: '#64748b' }} role="status" aria-live="polite">
      {label}
    </div>
  );
}

// Modal-only — chunk downloads the first time the admin opens the dialog.
const CustomerEmailModal = lazyRetry(() => import('../components/CustomerEmailModal'));
const CommsPanel = lazyRetry(() => import('../components/CommsPanel'));
// AddCustomerModal is tiny and eager (not lazy) so opening it can never hit a
// stale-chunk load failure — which the recovery would resolve by reloading the
// whole page (reads as "the button just refreshes").
import AddCustomerModal from '../components/AddCustomerModal';
import ActionMenu from '../components/ActionMenu';
import BridgeStatusDot from '../components/BridgeStatusDot';
const FulfillmentSettingsModal = lazyRetry(() => import('../components/FulfillmentSettingsModal'));
import categories from '../data/categories.json';

// Legacy flat nav removed — see GroupedSidebar.jsx

function LazySectionFallback({ label = 'Loading section…' }) {
  return (
    <div
      className="adm-panel"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 24, color: '#64748b' }}
      role="status"
      aria-live="polite"
    >
      <Loader2 size={16} className="spin" /> {label}
    </div>
  );
}

const COMPACT_CUSTOMER_ROWS = 8;

const ORDER_TAB_DEFS = [
  { key: 'new', label: 'New' },
  { key: 'handed', label: 'Handed Over' },
  { key: 'progress', label: 'In Progress' },
  { key: 'sent', label: 'Order Confirmation' },
  { key: 'paid', label: 'Payment' },
  { key: 'all', label: 'All orders', overview: true },
];
const ORDER_TAB_LABELS = Object.fromEntries(ORDER_TAB_DEFS.map((t) => [t.key, t.label]));

const ADMIN_PAGE_SIZE = 50;
const CUSTOMER_SERVICE_SECTIONS = ['orders', 'customers', 'comms'];

function sectionsForAdminRole(role) {
  return role === 'customer_service'
    ? CUSTOMER_SERVICE_SECTIONS
    : NAV_GROUPS.map((item) => item.id);
}
const randFormatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2, maximumFractionDigits: 4 });

function formatRandAmount(value) {
  const amount = Number(value || 0);
  return randFormatter.format(amount);
}

function orderAmountExVat(order) {
  const total = Number(order?.total_ex_vat);
  if (Number.isFinite(total) && total > 0) return total;
  const items = (order?.final_items?.length ? order.final_items : null)
    || order?.original_items || order?.items || [];
  let sum = 0;
  for (const item of items) {
    const qty = Number(item?.qty ?? item?.quantity ?? 0);
    const price = Number(item?.unitPrice ?? item?.price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price)) sum += qty * price;
  }
  return sum;
}

// Promo/discount the customer applied at checkout (migration 028 columns on the
// order row). Returns null when no code was used.
function orderPromo(order) {
  const code = String(order?.promo_code || '').trim();
  if (!code) return null;
  const discountPct = Number(order?.discount_pct);
  const discountAmount = Number(order?.discount_amount);
  return {
    code,
    discountPct: Number.isFinite(discountPct) ? discountPct : null,
    discountAmount: Number.isFinite(discountAmount) ? discountAmount : null,
  };
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatJoinStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'Pending';
  if (raw === 'joined') return 'Joined';
  if (raw === 'not joined' || raw === 'no thanks') return 'No thanks';
  return raw.replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

function renderNoteSections(noteSections) {
  if (!noteSections.length) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No notes yet</span>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {noteSections.map((section) => (
        <div key={section.title} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{section.title}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {section.lines.map((line, index) => (
              <div key={`${section.title}-${index}`} style={{ fontSize: 13, color: '#374151', lineHeight: 1.55, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: '#16a34a', fontWeight: 700 }}>•</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const PRODUCT_IMAGE_SLOTS = [
  { key: 'image', label: 'Image 1 (primary)' },
  { key: 'secondaryImage', label: 'Image 2' },
  { key: 'imageThree', label: 'Image 3' },
  { key: 'imageFour', label: 'Image 4' },
];

// The product edit form mirrors the four taxonomy levels stored in the DB
// (category, subcategory_one … subcategory_four). Every `child*Id` is a slug
// `child*Id` is a slug from the taxonomy tree at that level — empty string
// means "no value at this level". Saving collapses these into the
// `categoryPath` array, which the API maps back to the DB columns.
const emptyForm = {
  code: '',
  name: '',
  description: '',
  packDescription: '',
  unitsOfIssue: 'EACH',
  minQty: '1',
  image: '',
  secondaryImage: '',
  imageThree: '',
  imageFour: '',
  price: '0',
  stockOnHand: '1',
  isNewArrival: false,
  toOrder: false,
  availabilityLoading: false,
  availabilitySchemaReady: null,
  incomingStatus: 'none',
  incomingQty: '',
  incomingEta: '',
  shipmentRef: '',
  allowPreorder: false,
  categoryId: categories[0]?.id || '',
  childIds: categories[0]?.children?.[0]?.id ? [categories[0].children[0].id] : [],
};

function categoryLabel(id, tree = categories) {
  return categoryLabelFromTree(tree, id);
}

function subcategoryOptions(categoryId, tree = categories) {
  return subcategoryOptionsFromTree(tree, categoryId);
}

/** Return array of ancestor IDs from root down to (but not including) targetId. */
function findNodePath(tree, targetId, path = []) {
  for (const node of (tree || [])) {
    if (node.id === targetId) return path;
    if (node.children?.length) {
      const found = findNodePath(node.children, targetId, [...path, node.id]);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Look up the children of a node by id within an arbitrary tree. */
function childrenOf(tree, id) {
  if (!id) return [];
  const stack = [...(tree || [])];
  while (stack.length) {
    const node = stack.shift();
    if (node.id === id) return node.children || [];
    if (node.children?.length) stack.push(...node.children);
  }
  return [];
}

/**
 * If `currentId` is set but not in `options`, prepend a synthetic entry so
 * the user can still see (and replace) a value that no longer maps to a
 * live taxonomy node — e.g. a subcategory that was renamed or deleted.
 */
function withCurrentOption(options, currentId) {
  if (!currentId || options.some((o) => o.id === currentId)) return options;
  return [{ id: currentId, label: `${currentId} (missing)` }, ...options];
}

/** Build the form's category state from a saved product's categoryPath. */
function categoryFormFromPath(categoryPath = [], tree = categories) {
  const categoryId = categoryPath[0] || tree[0]?.id || '';
  return {
    categoryId,
    childIds: categoryPath.slice(1).filter(Boolean),
  };
}

/** Gold pill for pre-registered CSV customers who signed up (auto-approved, code allocated manually). */
function TenThousandClubBadge({ customer }) {
  if (!customer?.tags?.includes?.('10000 club')) return null;
  return (
    <span
      title="Pre-registered customer — auto-approved at signup. Allocate their customer code manually."
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.4,
        color: '#92400e',
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      10000 CLUB
    </span>
  );
}

const LAST_EMAIL_LABELS = {
  welcome: 'Welcome sent',
  campaign: 'Campaign sent',
  order_confirmation: 'Order confirmation sent',
  trade_application: 'Application ack sent',
};

function relativeSince(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Small pill showing the last email sent to a customer + when. */
function LastEmailBadge({ customer }) {
  const type = customer?.last_email_type;
  if (!type) return null;
  const label = LAST_EMAIL_LABELS[type] || 'Email sent';
  const when = relativeSince(customer?.last_email_at);
  return (
    <span
      title={`Last email: ${label}${customer?.last_email_at ? ` (${new Date(customer.last_email_at).toLocaleString()})` : ''}`}
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#1e40af',
        background: '#dbeafe',
        border: '1px solid #93c5fd',
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      ✉ {label}{when ? ` · ${when}` : ''}
    </span>
  );
}

function compactItems(items = []) {
  return items.map((item) => `${item.code}${item.name ? ` ${item.name}` : ''} × ${item.qty}`).join(', ');
}

function csvDownload(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatStockUnits(qty) {
  const n = qty === null || qty === undefined ? 0 : Number(qty);
  return `${Number.isFinite(n) ? n : 0} units`;
}

function productToForm(product, tree = categories) {
  return {
    code: product.code || '',
    name: product.name || '',
    description: product.description || '',
    packDescription: product.packDescription || '',
    unitsOfIssue: product.unitsOfIssue || 'EACH',
    minQty: String(Math.max(1, Math.floor(Number(product.minQty) || 1))),
    image: product.image || product.images?.[0] || '',
    secondaryImage: product.secondaryImage || product.images?.[1] || '',
    imageThree: product.imageThree || product.images?.[2] || '',
    imageFour: product.imageFour || product.images?.[3] || '',
    price: String(product.price ?? 0),
    stockOnHand: product.stockOnHand != null ? String(product.stockOnHand) : '',
    isNewArrival: !!product.isNew,
    toOrder: !!product.toOrder,
    availabilityLoading: false,
    availabilitySchemaReady: null,
    incomingStatus: 'none',
    incomingQty: '',
    incomingEta: '',
    shipmentRef: '',
    allowPreorder: false,
    ...categoryFormFromPath(product.categoryPath, tree),
  };
}

function WhatsappOptIn({ value }) {
  if (value == null) return <span className="adm-muted">—</span>;
  return value
    ? <Check size={16} color="#15803d" strokeWidth={3} aria-label="WhatsApp yes" />
    : <X size={16} color="#dc2626" strokeWidth={3} aria-label="WhatsApp no" />;
}

export default function AdminPage({ customer, onViewPortal, onSignOut }) {
  const initialOrderWorkspaceId = useMemo(() => orderWorkspaceIdFromPath(), []);
  const allowedSectionIds = useMemo(() => sectionsForAdminRole(customer?.role), [customer?.role]);
  const [activeSection, setActiveSection] = useState(() => {
    const preferred = initialOrderWorkspaceId ? 'orders' : 'catalogue';
    return allowedSectionIds.includes(preferred) ? preferred : allowedSectionIds[0] || 'orders';
  });
  const [productLoaderCode, setProductLoaderCode] = useState('');
  const [siteContentTab, setSiteContentTab] = useState('featured');
  const { data: dashStats } = useDashboardStats();
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [loadingError, setLoadingError] = useState('');
  const [liveCategories, setLiveCategories] = useState([]);
  const [saving, setSaving] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState(emptyForm);
  const [editorError, setEditorError] = useState('');
  const [editorImageUploading, setEditorImageUploading] = useState(false);
  const [editorImageDragOver, setEditorImageDragOver] = useState('');
  const editorImageFileInputRefs = useRef({});
  const [profileCustomer, setProfileCustomer] = useState(null);
  const [profileOrders, setProfileOrders] = useState([]);
  const [profileOrdersTotal, setProfileOrdersTotal] = useState(0);
  const [profileOrdersLoading, setProfileOrdersLoading] = useState(false);
  const [profileOrdersError, setProfileOrdersError] = useState('');
  const profileOrdersReqSeqRef = useRef(0);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [contentEditProduct, setContentEditProduct] = useState(null);
  const [contentEditForm, setContentEditForm] = useState({ image: '', description: '', packDescription: '', unitsOfIssue: 'EACH', code: '' });
  const [contentEditSaving, setContentEditSaving] = useState(false);
  const [contentEditError, setContentEditError] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);
  const imageFileInputRef = useRef(null);

  const [imageViewUrl, setImageViewUrl] = useState('');
  const reorderPanelRef = useRef(null);

  const [catalogTotal, setCatalogTotal] = useState(0);
  const [archiveCatalogTotal, setArchiveCatalogTotal] = useState(0);
  const [statsCustomerTotal, setStatsCustomerTotal] = useState(0);
  const [statsOrderTotal, setStatsOrderTotal] = useState(0);

  const [customerTab, setCustomerTab] = useState('regular');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchDebounced, setCustomerSearchDebounced] = useState('');
  const [customerBusinessType, setCustomerBusinessType] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerRows, setCustomerRows] = useState([]);
  const [customerTotal, setCustomerTotal] = useState(0);
  // Compact by default: the section opens showing a handful of rows per tab
  // rather than every approved customer / trade request at once.
  const [customerListExpanded, setCustomerListExpanded] = useState(false);
  const customersReqSeqRef = useRef(0);
  const customersCacheRef = useRef(new Map());
  const customersCacheKeyRef = useRef('');
  const [customerEmailOpen, setCustomerEmailOpen] = useState(false);
  const [composeTarget, setComposeTarget] = useState(null);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [profileSource, setProfileSource] = useState('portal');
  const [approvalCodes, setApprovalCodes] = useState({});
  const [protoNameSaving, setProtoNameSaving] = useState(null);

  // Pricing state now lives in PricingPanel.

  const [taxonomyTree, setTaxonomyTree] = useState(categories);
  const [toast, setToast] = useState(null);
  const [editTaxonomyModal, setEditTaxonomyModal] = useState(null);
  const [newSubModal, setNewSubModal] = useState(null);
  const [newCategoryModal, setNewCategoryModal] = useState(null);
  const [deleteSubModal, setDeleteSubModal] = useState(null);
  const [taxonomySaving, setTaxonomySaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  // The order the admin has open, kept renderable after a list refresh drops
  // it from the current tab (see the pinning effects near loadOrders).
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const lastExpandedRowRef = useRef(null);
  const pinToastForRef = useRef(null);
  // Order Workspace now lives below the order list, revealed on demand. Auto-open
  // when a workspace was deep-linked so the URL still lands on it.
  const [orderWorkspaceOpen, setOrderWorkspaceOpen] = useState(Boolean(initialOrderWorkspaceId));

  const [fulfillmentOrder, setFulfillmentOrder] = useState(null);
  const [fulfillmentItems, setFulfillmentItems] = useState([]);
  const [fulfillmentNotes, setFulfillmentNotes] = useState('');
  const [fulfillmentSaving, setFulfillmentSaving] = useState(false);
  const [editingItemIdx, setEditingItemIdx] = useState(null);
  const [productSwapSearch, setProductSwapSearch] = useState('');
  const [productSwapResults, setProductSwapResults] = useState([]);
  const [productSwapLoading, setProductSwapLoading] = useState(false);
  const swapSearchTimerRef = useRef(null);

  const [orders, setOrders] = useState([]);
  const ordersReqSeqRef = useRef(0);
  const ordersCacheRef = useRef(new Map());
  const ordersCacheKeyRef = useRef('');
  const orderTabCountsSigRef = useRef('');
  // The sidebar badge behaves like a notification: opening Order Requests
  // marks the current count as SEEN (persisted), and the badge only returns
  // when the count rises above what was seen.
  const [ordersBadgeSeen, setOrdersBadgeSeen] = useState(() => {
    const stored = Number(localStorage.getItem('adm-orders-badge-seen'));
    return Number.isFinite(stored) ? stored : 0;
  });
  const [orderTab, setOrderTab] = useState('new');
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderTabCounts, setOrderTabCounts] = useState(null);
  const [orderTrashEnabled, setOrderTrashEnabled] = useState(false);
  const [orderSearchDebounced, setOrderSearchDebounced] = useState('');
  const [focusOrderId, setFocusOrderId] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [fulfillmentSettingsOpen, setFulfillmentSettingsOpen] = useState(false);
  const [fulfillmentUsers, setFulfillmentUsers] = useState([]);
  const [activeFulfillmentUserId, setActiveFulfillmentUserId] = useState(loadActiveUserId);
  const [presaleInvoices, setPresaleInvoices] = useState({});
  const [presaleUploading, setPresaleUploading] = useState('');
  const [confirmationSent, setConfirmationSent] = useState({});
  const [paymentRecords, setPaymentRecords] = useState({});
  const [popUploading, setPopUploading] = useState('');

  // Weekly featured specials — state stays in AdminPage so the Product
  // Manager star toggle can add/remove without cross-tab coupling. The
  // Specials tab reads/writes via SpecialsPanel (see props below).
  const [specials, setSpecials] = useState([]);
  const [specialsSaving, setSpecialsSaving] = useState(false);




  const [categoryProductCounts, setCategoryProductCounts] = useState({});

  const mainCategories = useMemo(
    () => taxonomyTree.map((item) => ({ id: item.id, label: item.label })),
    [taxonomyTree],
  );
  const firstMainCategoryId = mainCategories[0]?.id || '';

  useEffect(() => {
    fetchDistinctCategories().then(setLiveCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setCustomerSearchDebounced(customerSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);
  useEffect(() => { setCustomerPage(1); }, [customerTab, customerSearchDebounced, customerBusinessType]);
  useEffect(() => {
    const timer = setTimeout(() => setOrderSearchDebounced(orderSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [orderSearch]);
  useEffect(() => { setOrderPage(1); }, [orderTab, orderSearchDebounced]);
  // Banner + Specials own their own load effects — see BannerPanel and SpecialsPanel.


  const refreshDashboardStats = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats() });
  };


  // Tabs backed by their own panels (analytics, scheduled) are not customer
  // lists — never query the customers endpoint for them.
  const CUSTOMER_LIST_TABS = new Set(['requests', 'regular', 'proto-active']);

  const loadCustomers = async () => {
    if (!CUSTOMER_LIST_TABS.has(customerTab)) return;
    // Same discipline as loadOrders: sequence the requests so a slow response
    // can never repaint over a newer one, and paint revisited tabs instantly
    // from cache while revalidating — the section used to blank on every tab,
    // page and search change, which is what made it feel choppy.
    const key = `${customerTab}|${customerPage}|${customerSearchDebounced}|${customerBusinessType}`;
    const seq = (customersReqSeqRef.current += 1);
    const cached = customersCacheRef.current.get(key);
    if (cached) {
      setCustomerRows(cached.rows);
      setCustomerTotal(cached.total);
    } else if (customersCacheKeyRef.current !== key) {
      setCustomerRows([]);
    }
    customersCacheKeyRef.current = key;
    setLoading(true);
    try {
      const data = customerTab === 'proto-active'
        ? await fetchProtoActiveCustomersPage({ page: customerPage, pageSize: ADMIN_PAGE_SIZE, searchQuery: customerSearchDebounced })
        : await fetchCustomersPage({
          page: customerPage,
          pageSize: ADMIN_PAGE_SIZE,
          tab: customerTab,
          searchQuery: customerSearchDebounced,
          businessType: customerBusinessType,
        });
      if (seq !== customersReqSeqRef.current) return; // superseded — drop it
      customersCacheRef.current.set(key, { rows: data.rows, total: data.total });
      setCustomerRows(data.rows);
      setCustomerTotal(data.total);
      if (data.migrationRequired && data.message) showToast(data.message, 'warning');
    } catch (err) {
      if (seq === customersReqSeqRef.current) {
        showToast(err.message || 'Failed to load customers', 'error');
        if (!cached) { setCustomerRows([]); setCustomerTotal(0); }
      }
    } finally {
      if (seq === customersReqSeqRef.current) setLoading(false);
    }
  };

  const [exportingCustomers, setExportingCustomers] = useState(false);
  const handleExportAllCustomers = async () => {
    if (exportingCustomers) return;
    setExportingCustomers(true);
    try {
      const { exportAllCustomersXlsx } = await import('../lib/exportCustomers');
      const counts = await exportAllCustomersXlsx();
      showToast(`Exported ${counts.portal} portal customer(s) and ${counts.preRegistration} pre-registration contact(s)`);
    } catch (err) {
      showToast(err.message || 'Customer export failed', 'error');
    } finally {
      setExportingCustomers(false);
    }
  };

  const saveProtoActiveName = async (row, field, value) => {
    const trimmed = String(value || '').trim();
    const current = String(row[field] || '').trim();
    if (trimmed === current) return;
    setProtoNameSaving(`${row.id}-${field}`);
    try {
      const updated = await updateProtoActiveCustomer(row.id, { [field]: trimmed || null });
      setCustomerRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)));
      if (profileCustomer?.id === row.id) setProfileCustomer((p) => ({ ...p, ...updated }));
      showToast('Saved', 'success');
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    } finally {
      setProtoNameSaving(null);
    }
  };

  const [importingCustomers, setImportingCustomers] = useState(false);
  const customerCsvRef = useRef(null);

  const handleCustomerCsvUpload = async (file) => {
    if (!file) return;
    setImportingCustomers(true);
    try {
      const { parseCustomerFile } = await import('../lib/customerCsvImport');
      const { rows, errors } = await parseCustomerFile(file);
      if (!rows.length) {
        showToast(errors[0] || 'No valid rows in that file', 'error');
        return;
      }
      // Upload in chunks so large files never hit request size/time limits.
      const CHUNK = 400;
      let imported = 0;
      let skipped = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const result = await importProtoActiveCustomers(rows.slice(i, i + CHUNK));
        imported += result.imported || 0;
        skipped += result.skipped || 0;
      }
      showToast(
        `Imported ${imported} customer(s) into Pre-registration${skipped ? ` — ${skipped} skipped (duplicates/invalid)` : ''}${errors.length ? ` — ${errors.length} row(s) had errors` : ''}`,
        errors.length || skipped ? 'warning' : 'success',
      );
      await loadCustomers();
    } catch (err) {
      showToast(err.message || 'Customer import failed', 'error');
    } finally {
      setImportingCustomers(false);
    }
  };

  const handleDeleteAllProtoActive = async () => {
    const typed = window.prompt('This deletes EVERY pre-registration customer. Type DELETE ALL to confirm:');
    if (typed !== 'DELETE ALL') return;
    setSaving('del-all-proto');
    try {
      const result = await deleteAllProtoActiveCustomers();
      showToast(`Deleted ${result.deleted} pre-registration customer(s)`);
      await loadCustomers();
    } catch (err) {
      showToast(err.message || 'Delete all failed', 'error');
    } finally {
      setSaving('');
    }
  };

  const removeProtoActiveCustomer = async (row) => {
    if (!window.confirm(`Remove ${row.name || row.email} from the pre-registration list?`)) return;
    setSaving(`del-proto-${row.id}`);
    try {
      await deleteProtoActiveCustomer(row.id);
      await loadCustomers();
      if (profileCustomer?.id === row.id) closeCustomerProfile();
      showToast('Pre-registration contact removed');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setSaving('');
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // `fresh` bypasses the counts endpoint's edge cache. Pass it after a write:
  // otherwise a rename can read back counts computed up to a minute earlier and
  // the renamed category shows a stale badge — or none — as if it had failed.
  const reloadTaxonomy = async ({ fresh = false } = {}) => {
    const tree = await fetchTaxonomy();
    setTaxonomyTree(tree);
    setLiveTaxonomyTree(tree);
    try {
      const counts = await fetchCategoryProductCounts({ fresh });
      setCategoryProductCounts(counts);
    } catch { /* optional */ }
    return tree;
  };

  const handleTaxonomyConflict = async (err) => {
    if (err.status === 409) {
      showToast(err.message || 'Categories were changed by someone else — reloading', 'error');
      await reloadTaxonomy();
      return true;
    }
    return false;
  };

  const handleCategoryReorder = async (newTree) => {
    setTaxonomyTree(newTree);
    setLiveTaxonomyTree(newTree);
    setTaxonomySaving(true);
    try {
      await replaceFullTaxonomy(newTree);
      invalidateAdminCache();
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      showToast('Category order saved — live site updates within ~30 seconds', 'success');
    } catch (err) {
      if (await handleTaxonomyConflict(err)) return;
      showToast(err.message || 'Failed to save category order', 'error');
      const reverted = await fetchTaxonomy();
      setTaxonomyTree(reverted);
      setLiveTaxonomyTree(reverted);
    } finally {
      setTaxonomySaving(false);
    }
  };

  const loadOrders = async () => {
    // Tab switches and the 30s auto-refresh can put several requests in
    // flight at once; a slow response landing after a newer one used to
    // repaint the list with stale rows — the "order flickers away" bug. Only
    // the latest request may touch state.
    const key = `${orderTab}|${orderPage}|${orderSearchDebounced}`;
    const seq = (ordersReqSeqRef.current += 1);
    // Paint a previously seen tab instantly from cache while revalidating, so
    // switching tabs never blanks the list or shows another tab's orders.
    const cached = ordersCacheRef.current.get(key);
    if (cached) {
      setOrders(cached.rows);
      setOrderTotal(cached.total);
    } else if (ordersCacheKeyRef.current !== key) {
      // Unseen tab: clear rather than leave the previous tab's rows on screen.
      setOrders([]);
    }
    ordersCacheKeyRef.current = key;
    setLoading(true);
    try {
      const data = await fetchOrdersPage({
        page: orderPage,
        pageSize: ADMIN_PAGE_SIZE,
        search: orderSearchDebounced,
        tab: orderTab,
      });
      if (seq !== ordersReqSeqRef.current) return; // superseded — drop it
      setOrderTrashEnabled(data.orderTrashEnabled);
      // The 30s/focus refresh usually returns exactly what is already on
      // screen. Replacing state with an identical-but-new array still
      // re-renders every row AND re-fires the per-row detail effects below
      // (confirmation status, presale invoices, payment records), which is
      // what made the Payment and All-orders tabs visibly blink on every
      // refresh. If nothing changed, change nothing.
      const sig = JSON.stringify([data.total, data.rows.map((r) => [r.id, r.status, r.updated_at, r.confirmation_sent_at ?? null])]);
      const prevEntry = ordersCacheRef.current.get(key);
      const unchanged = prevEntry?.sig === sig && ordersCacheKeyRef.current === key && orders.length === data.rows.length;
      ordersCacheRef.current.set(key, { rows: data.rows, total: data.total, sig });
      if (!unchanged) {
        setOrders(data.rows);
        setOrderTotal(data.total);
      }
      if (data.tabCounts) {
        const countsSig = JSON.stringify(data.tabCounts);
        if (orderTabCountsSigRef.current !== countsSig) {
          orderTabCountsSigRef.current = countsSig;
          setOrderTabCounts(data.tabCounts);
        }
        const badge = data.tabCounts.unpaid ?? data.tabCounts.new;
        if (badge != null) setNewOrdersCount(badge);
      }
    } catch (err) {
      if (seq === ordersReqSeqRef.current) showToast(err.message || 'Failed to load orders', 'error');
    } finally {
      if (seq === ordersReqSeqRef.current) setLoading(false);
    }
  };

  const activeFulfillmentUser = useMemo(
    () => fulfillmentUsers.find((u) => u.id === activeFulfillmentUserId) || null,
    [fulfillmentUsers, activeFulfillmentUserId],
  );
  const victorCanSend = isVictorSender(activeFulfillmentUser);

  const orderListGridCols = orderTab === 'sent' || orderTab === 'paid'
    ? '1.3fr 1.1fr 0.9fr 0.8fr 2fr 120px 56px'
    : '1.4fr 1.3fr 1.1fr 0.8fr 1fr 160px 80px';

  const confirmationSentIds = useMemo(() => {
    const ids = new Set(Object.keys(confirmationSent).filter((id) => confirmationSent[id]?.sentAt));
    for (const order of orders) {
      if (order.confirmation_sent_at) ids.add(String(order.id));
    }
    return ids;
  }, [confirmationSent, orders]);

  const renderOrderConfirmationActions = (order) => {
    if (normalizeOrderStatus(order.status) !== 'order sent') return null;
    if (isOrderConfirmationSent(order, confirmationSentIds)) return null;
    const invoice = presaleInvoices[order.id];
    const uploading = presaleUploading === order.id;
    const sending = saving === `send-${order.id}`;
    return (
      <div className="adm-oc-col">
        <span className="adm-oc-label">Order Confirmation</span>
        <label className="adm-oc-upload-btn">
          {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
          {invoice ? 'Replace invoice' : 'Upload invoice'}
          <input
            type="file"
            accept=".pdf,application/pdf,image/*"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handlePresaleUpload(order, file);
            }}
          />
        </label>
        {invoice && <span className="adm-oc-uploaded">✓ {invoice.filename || 'Invoice uploaded'}</span>}
        {victorCanSend ? (
          <button
            type="button"
            className="adm-oc-send-btn"
            disabled={sending}
            onClick={() => void sendOrderConfirmation(order)}
          >
            {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        ) : (
          <span className="adm-oc-victor-gate" title={CUSTOMER_SEND_FORBIDDEN}>Victor only</span>
        )}
      </div>
    );
  };

  const renderPaymentActions = (order) => {
    const key = normalizeOrderStatus(order.status);
    if (key === 'payment received') {
      const pop = paymentRecords[order.id];
      return (
        <div className="adm-oc-col">
          <span className="adm-oc-label adm-oc-label--paid">Paid</span>
          {pop?.filename && <span className="adm-oc-uploaded">✓ {pop.filename}</span>}
        </div>
      );
    }
    if (key !== 'order sent' || !isOrderConfirmationSent(order, confirmationSentIds)) return null;

    const pop = paymentRecords[order.id];
    const uploading = popUploading === order.id;
    const isPaid = pop?.paid === true;

    return (
      <div className="adm-oc-col">
        <span className="adm-oc-label">Awaiting payment</span>
        <div className="adm-pay-toggle">
          <button
            type="button"
            className={`adm-pay-toggle__btn${!isPaid ? ' adm-pay-toggle__btn--on' : ''}`}
            onClick={() => void handlePaymentStatus(order, false)}
          >
            Not paid
          </button>
          <button
            type="button"
            className={`adm-pay-toggle__btn${isPaid ? ' adm-pay-toggle__btn--on' : ''}`}
            onClick={() => void handlePaymentStatus(order, true)}
          >
            Paid
          </button>
        </div>
        <label className="adm-oc-upload-btn">
          {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
          {pop?.filename ? 'Replace POP' : 'Upload POP'}
          <input
            type="file"
            accept=".pdf,application/pdf,image/*"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handlePopUpload(order, file);
            }}
          />
        </label>
        {pop?.filename && <span className="adm-oc-uploaded">✓ {pop.filename}</span>}
        {isPaid && (
          victorCanSend ? (
            <button
              type="button"
              className="adm-presale-pay-btn"
              disabled={saving === `advance-${order.id}`}
              onClick={() => void advanceOrderStatus(order, 'payment received')}
            >
              <Check size={14} strokeWidth={2.5} />
              {saving === `advance-${order.id}` ? 'Updating…' : 'Confirm payment'}
            </button>
          ) : (
            <span className="adm-oc-victor-gate" title={PAYMENT_RECEIVED_FORBIDDEN}>Victor only</span>
          )
        )}
      </div>
    );
  };

  const handlePresaleUpload = async (order, file) => {
    setPresaleUploading(order.id);
    try {
      const meta = await uploadPresaleInvoice(order.id, file);
      setPresaleInvoices((prev) => ({ ...prev, [order.id]: meta }));
      showToast(`Presale invoice uploaded for ${order.order_number || order.id.slice(0, 8)}`);
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setPresaleUploading('');
    }
  };

  const handlePopUpload = async (order, file) => {
    setPopUploading(order.id);
    try {
      const meta = await uploadPop(order.id, file, { paid: paymentRecords[order.id]?.paid !== false });
      setPaymentRecords((prev) => ({ ...prev, [order.id]: meta }));
      showToast(`Proof of payment uploaded for ${order.order_number || order.id.slice(0, 8)}`);
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setPopUploading('');
    }
  };

  const handlePaymentStatus = async (order, paid) => {
    setSaving(`pay-${order.id}`);
    try {
      const meta = await setPaymentStatus(order.id, paid);
      setPaymentRecords((prev) => ({ ...prev, [order.id]: { ...prev[order.id], ...meta } }));
    } catch (err) {
      showToast(err.message || 'Failed to update payment status', 'error');
    } finally {
      setSaving('');
    }
  };

  const sendOrderConfirmation = async (order) => {
    const email = order.customers?.email;
    if (!email) {
      showToast('This customer has no email address on file.', 'error');
      return;
    }
    if (!victorCanSend) {
      showToast(CUSTOMER_SEND_FORBIDDEN, 'error');
      return;
    }
    const invoiceAttached = Boolean(presaleInvoices[order.id]);
    const confirmMsg = invoiceAttached
      ? `Send order confirmation + presale invoice to ${email}?`
      : `Send order confirmation to ${email}? (No presale invoice uploaded yet)`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(`send-${order.id}`);
    try {
      const emailItems = buildEmailItemsFromOrder(order);
      const autoNotes = deriveAutoNotesFromItems(emailItems).join('\n');
      const { hasPrices, total, items: customerItems } = resolveCustomerOrderPricing(emailItems);
      const pdfBase64 = await generateOrderPdfBase64({
        order,
        items: customerItems,
        autoNotes,
        userNotes: order.order_change_notes || '',
        assignedTo: activeFulfillmentUser?.name || '',
        total,
        hasPrices,
      });
      // Upload the PDF straight to storage via a signed URL so we never hit
      // Vercel's 4.5 MB request-body limit (large PDFs used to 413 on send).
      const urlRes = await fetch('/api/order-confirmation-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not prepare PDF upload');
      const putRes = await fetch(urlData.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' },
        body: base64ToBlob(pdfBase64, 'application/pdf'),
      });
      if (!putRes.ok) throw new Error('Could not upload order confirmation PDF');
      const emailRes = await fetch('/api/send-order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          to: email,
          customerName: order.customers?.name,
          orderNumber: displayOrderNumber(order),
          orderDate: order.created_at,
          items: customerItems,
          autoNotes,
          userNotes: order.order_change_notes || '',
          assignedTo: activeFulfillmentUser?.name || '',
          total,
          hasPrices,
          senderUserId: activeFulfillmentUser?.id || '',
          senderName: activeFulfillmentUser?.name || '',
          confirmationStoragePath: urlData.path,
          pdfFilename: `proto-order-confirmation-${displayOrderNumber(order)}.pdf`,
          deliveryMethod: order.delivery_method || '',
          customerNotes: order.customer_notes || '',
        }),
      });
      const emailData = await emailRes.json();
      if (!emailRes.ok) throw new Error(emailData.error || 'Email send failed');
      if (normalizeOrderStatus(order.status) !== 'order sent') {
        await advanceOrderWorkflow(order.id, 'order sent', {
          senderUserId: activeFulfillmentUser?.id,
          senderName: activeFulfillmentUser?.name,
        });
        setOrders((prev) => prev.map((item) => (
          item.id === order.id ? { ...item, status: 'order sent' } : item
        )));
      }
      const sentMeta = await markConfirmationSent(order.id);
      setConfirmationSent((prev) => ({ ...prev, [order.id]: sentMeta }));
      setOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, confirmation_sent_at: sentMeta.sentAt || sentMeta.updatedAt }
          : item
      )));
      setOrderTab('paid');
      showToast(`Confirmation sent to ${email}${emailData.presaleIncluded ? ' with presale invoice' : ''} — moved to Payment`);
    } catch (err) {
      showToast(err.message || 'Could not send order confirmation', 'error');
    } finally {
      setSaving('');
    }
  };

  useEffect(() => { if (activeSection === 'customers') void loadCustomers(); }, [activeSection, customerPage, customerTab, customerSearchDebounced, customerBusinessType]);
  useEffect(() => { setCustomerListExpanded(false); }, [customerTab]);
  // Pricing load lives in PricingPanel.
  useEffect(() => { void reloadTaxonomy(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    const tab = params.get('orderTab');
    const focus = params.get('focusOrder');
    // Deep links must respect the same role allowlist as the visible sidebar.
    // Without this check, a restricted user could open a hidden section with
    // `?section=...` even though the navigation correctly omitted it.
    if (section && allowedSectionIds.includes(section)) setActiveSection(section);
    if (tab) setOrderTab(tab);
    if (focus) setFocusOrderId(focus);
    if (section || tab || focus) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [allowedSectionIds]);

  useEffect(() => {
    if (!focusOrderId || activeSection !== 'orders' || !orders.length) return;
    setExpandedOrderId(focusOrderId);
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-order-id="${focusOrderId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusOrderId('');
    }, 300);
    return () => clearTimeout(timer);
  }, [focusOrderId, activeSection, orders]);
  useEffect(() => { if (activeSection === 'orders') void loadOrders(); }, [activeSection, orderPage, orderTab, orderSearchDebounced]);
  useEffect(() => {
    if (activeSection !== 'orders') return;
    setOrdersBadgeSeen(newOrdersCount);
    try { localStorage.setItem('adm-orders-badge-seen', String(newOrdersCount)); } catch { /* ignore */ }
  }, [activeSection, newOrdersCount]);
  useEffect(() => {
    if (activeSection !== 'orders') return undefined;
    fetchFulfillmentUsers()
      .then((rows) => setFulfillmentUsers(rows))
      .catch(() => {});
    const syncUser = () => setActiveFulfillmentUserId(loadActiveUserId());
    window.addEventListener('storage', syncUser);
    window.addEventListener('focus', syncUser);
    return () => {
      window.removeEventListener('storage', syncUser);
      window.removeEventListener('focus', syncUser);
    };
  }, [activeSection]);

  // Merge fetched per-order detail into a map WITHOUT changing state identity
  // when nothing is new — a same-content setState here re-renders the whole
  // order list, and these effects run on every refresh cycle.
  const mergeMapIfChanged = (setter) => (rows) => setter((prev) => {
    let changed = false;
    for (const k of Object.keys(rows || {})) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(rows[k])) { changed = true; break; }
    }
    return changed ? { ...prev, ...rows } : prev;
  });

  // One effect, not the previous two overlapping copies of it (both fetched
  // confirmation status on every orders change, one without a section guard).
  useEffect(() => {
    if (activeSection !== 'orders') return;
    const ids = orders.filter((o) => normalizeOrderStatus(o.status) === 'order sent').map((o) => o.id);
    if (!ids.length) return;
    fetchPresaleInvoices(ids)
      .then(mergeMapIfChanged(setPresaleInvoices))
      .catch((err) => showToast(err.message || 'Failed to load presale invoices', 'error'));
    fetchConfirmationSent(ids)
      .then(mergeMapIfChanged(setConfirmationSent))
      .catch((err) => showToast(err.message || 'Failed to load confirmation status', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, orderTab, orders]);

  useEffect(() => {
    if (activeSection !== 'orders' || orderTab !== 'paid') return;
    const ids = orders
      .filter((o) => orderMatchesTab(o, 'paid', { confirmationSentIds }))
      .map((o) => o.id);
    if (!ids.length) return;
    fetchPaymentRecords(ids)
      .then(mergeMapIfChanged(setPaymentRecords))
      .catch((err) => showToast(err.message || 'Failed to load payment records', 'error'));
    fetchConfirmationSent(ids)
      .then(mergeMapIfChanged(setConfirmationSent))
      .catch((err) => showToast(err.message || 'Failed to load confirmation status', 'error'));
    // NOTE: confirmationSentIds is intentionally NOT a dependency. It is a
    // useMemo that returns a new Set whenever confirmationSent changes, and this
    // effect calls setConfirmationSent — so including it created an infinite
    // fetch/re-render loop (orders flickering every couple of seconds on the
    // Payment tab). Re-running on orders/tab change is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, orderTab, orders]);

  useEffect(() => {
    if (activeSection !== 'orders') return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') void loadOrders(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [activeSection]);

  // Remember the expanded order's row while it is present in the list, and
  // unpin the moment it reappears (e.g. the admin switched to the tab it
  // moved to).
  useEffect(() => {
    const row = orders.find((o) => o.id === expandedOrderId);
    if (row) {
      lastExpandedRowRef.current = row;
      setPinnedOrder((prev) => (prev ? null : prev));
    }
  }, [orders, expandedOrderId]);

  // An expanded order can vanish mid-fulfilment: the team's first tick
  // advances its status server-side (pending -> order in progress), and the
  // next 30s/focus refresh drops it from the tab the admin is looking at.
  // Losing the panel you are working in with no explanation reads as a bug,
  // so keep the open order pinned at the top of the list until it is
  // collapsed or the admin changes tab, and say what happened once.
  useEffect(() => {
    if (!expandedOrderId) { setPinnedOrder(null); return; }
    if (loading) return; // only judge settled lists, never mid-refresh blanks
    if (orders.some((o) => o.id === expandedOrderId)) return;
    const remembered = lastExpandedRowRef.current;
    if (!remembered || remembered.id !== expandedOrderId) return;
    setPinnedOrder((prev) => (prev?.id === expandedOrderId ? prev : remembered));
    if (pinToastForRef.current !== expandedOrderId) {
      pinToastForRef.current = expandedOrderId;
      showToast(`Order ${remembered.order_number || ''} advanced out of this tab — kept on screen while open`.replace('  ', ' '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, expandedOrderId, loading]);

  // A deliberate tab/page/search change is a navigation, not a vanish — drop
  // the pin and let the new list speak for itself.
  useEffect(() => {
    setPinnedOrder(null);
  }, [orderTab, orderPage, orderSearchDebounced]);

  // Load specials on mount
  useEffect(() => {
    fetchSpecials().then((data) => setSpecials(data?.items || [])).catch(() => {});
  }, []);

  // Poll pending trade applications + new orders for sidebar badges
  useEffect(() => {
    const load = async () => {
      try {
        const [requests, ordersData] = await Promise.all([
          fetchCustomersPage({ tab: 'requests', pageSize: 1, searchQuery: '' }),
          fetchOrdersPage({ tab: 'new', pageSize: 1, page: 1 }),
        ]);
        setPendingCount(requests.total || 0);
        setNewOrdersCount(ordersData.tabCounts?.unpaid ?? ordersData.tabCounts?.new ?? 0);
      } catch { /* badges are best-effort */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  const specialsSet = new Set(specials.map((s) => s.productId));

  const toggleSpecial = async (product) => {
    let next;
    if (specialsSet.has(product.id)) {
      next = specials.filter((s) => s.productId !== product.id);
    } else {
      if (specials.length >= 10) { alert('Maximum 10 specials allowed. Remove one first.'); return; }
      next = [...specials, { productId: product.id, productName: product.name, productCode: product.code, productImage: product.image || '', deal: 'none', discountPct: 10, bogoX: 1, bogoY: 1 }];
    }
    setSpecials(next);
    setSpecialsSaving(true);
    try { await saveSpecials(next); } catch (err) { showToast(err.message || 'Failed to save specials', 'error'); } finally { setSpecialsSaving(false); }
  };

  const updateSpecialDeal = async (productId, patch) => {
    const next = specials.map((s) => s.productId === productId ? { ...s, ...patch } : s);
    setSpecials(next);
    setSpecialsSaving(true);
    try { await saveSpecials(next); } catch (err) { showToast(err.message || 'Failed to save specials', 'error'); } finally { setSpecialsSaving(false); }
  };

  const clearAllSpecials = async () => {
    if (!window.confirm('Remove all specials?')) return;
    setSpecials([]);
    setSpecialsSaving(true);
    try { await saveSpecials([]); } catch (err) { showToast(err.message || 'Failed to save specials', 'error'); } finally { setSpecialsSaving(false); }
  };

  const uploadImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setContentEditError('Only image files are supported.');
      return;
    }
    setImageUploading(true);
    setContentEditError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/upload-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, base64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setContentEditForm((f) => ({ ...f, image: json.url }));
    } catch (err) {
      setContentEditError(err.message || 'Image upload failed');
    } finally {
      setImageUploading(false);
    }
  };

  const uploadEditorImageFile = async (file, slotKey) => {
    if (!file || !file.type.startsWith('image/')) {
      setEditorError('Only image files are supported.');
      return;
    }
    setEditorImageUploading(true);
    setEditorError('');
    try {
      const url = await uploadDormantImage(file);
      setProductForm((current) => ({ ...current, [slotKey]: url }));
    } catch (err) {
      setEditorError(err.message || 'Image upload failed');
    } finally {
      setEditorImageUploading(false);
    }
  };

  const stats = useMemo(() => ({
    products: dashStats?.liveProducts ?? catalogTotal,
    archived: dashStats?.archivedProducts ?? archiveCatalogTotal,
    customers: dashStats?.customers ?? statsCustomerTotal,
    orders: dashStats?.orders ?? statsOrderTotal,
  }), [dashStats, catalogTotal, archiveCatalogTotal, statsCustomerTotal, statsOrderTotal]);

  const activeSectionLabel = useMemo(
    () => NAV_GROUPS.find((item) => item.id === activeSection)?.label || 'Admin',
    [activeSection],
  );

  const orderRows = useMemo(() => {
    if (!pinnedOrder || orders.some((o) => o.id === pinnedOrder.id)) return orders;
    return [{ ...pinnedOrder, __pinned: true }, ...orders];
  }, [orders, pinnedOrder]);

  const openNewProduct = () => {
    const firstCategory = taxonomyTree[0]?.id || categories[0]?.id || '';
    const firstChild = subcategoryOptions(firstCategory, taxonomyTree)[0]?.id || '';
    setEditingProduct(null);
    setProductForm({
      ...emptyForm,
      categoryId: firstCategory,
      childIds: firstChild ? [firstChild] : [],
    });
    setEditorError('');
    setEditorImageUploading(false);
    setEditorImageDragOver('');
    setEditorOpen(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({ ...productToForm(product, taxonomyTree), availabilityLoading: true });
    setEditorError('');
    setEditorImageUploading(false);
    setEditorImageDragOver('');
    setEditorOpen(true);
    if (!product.archivedBy) {
      void fetchProductAvailability(product.id)
        .then((result) => {
          setProductForm((current) => {
            if (current.code !== (product.code || '')) return current;
            const availability = result?.availability || {};
            return {
              ...current,
              availabilityLoading: false,
              availabilitySchemaReady…17527 tokens truncated…le drawer */}
      {profileCustomer && (
        <div className="adm-drawer-backdrop" onClick={closeCustomerProfile}>
          <div className="adm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="adm-drawer-head">
              <h3>Customer Profile</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!profileEditing && (
                  <button onClick={startEditProfile} className="adm-btn-ghost adm-btn-sm">Edit</button>
                )}
                <button onClick={closeCustomerProfile} className="adm-icon-btn"><X size={16} /></button>
              </div>
            </div>
            <div className="adm-drawer-body">
              <div className="adm-drawer-avatar">{(profileCustomer.business_name || profileCustomer.name || '?')[0].toUpperCase()}</div>
              <h2 className="adm-drawer-biz" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {profileCustomer.business_name || profileCustomer.name}
                <TenThousandClubBadge customer={profileCustomer} />
                <LastEmailBadge customer={profileCustomer} />
              </h2>

              <CustomerIqPanel
                customer={profileCustomer}
                orders={profileOrders}
                totalOrders={profileOrdersTotal}
                source={profileSource}
                loading={profileOrdersLoading}
                loadError={profileOrdersError}
              />

              {profileSource !== 'proto-active' && !profileCustomer.is_approved && (() => {
                const verification = traderVerificationSummary(profileCustomer);
                return (
                  <section className={`adm-trader-review adm-trader-review--${verification.tone}`} aria-label="Trader verification recommendation">
                    <div className="adm-trader-review-head">
                      <div>
                        <span className="adm-trader-review-kicker">Application evidence</span>
                        <h3>{verification.recommendation}</h3>
                      </div>
                    </div>
                    <p className="adm-trader-review-note">Evidence summary only — it is not a probability score. A staff member makes the final decision.</p>
                    <div className="adm-trader-evidence-list">
                      {verification.evidence.map((item) => (
                        <div className={`adm-trader-evidence adm-trader-evidence--${item.tone}`} key={item.label}>
                          {item.tone === 'neutral' || item.tone === 'review'
                            ? <Search size={15} aria-hidden="true" />
                            : <CheckCircle size={15} aria-hidden="true" />}
                          <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                        </div>
                      ))}
                    </div>
                    <div className="adm-trader-research">
                      <div><strong>Internet &amp; social check</strong><span>Not run automatically in this preview.</span></div>
                      <a className="adm-btn-ghost adm-btn-sm" href={businessSearchUrl(profileCustomer)} target="_blank" rel="noreferrer">
                        <Search size={13} /> Research business
                      </a>
                    </div>
                  </section>
                );
              })()}

              {profileSource !== 'proto-active' && (
                <CustomerApplicationDetails customer={profileCustomer} />
              )}

              {profileEditing ? (
                <div style={{ display: 'grid', gap: 12, marginTop: 4 }}>
                  {profileSource === 'proto-active' ? (
                    <>
                      {[
                        ['Account code', 'account_code', 'text'],
                        ['Business name', 'business_name', 'text'],
                        ['Email', 'email', 'email'],
                        ['Contact name', 'contact_name', 'text'],
                        ['First name', 'first_name', 'text'],
                      ].map(([label, key, type]) => (
                        <div key={key}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</label>
                          <input className="adm-field-input" type={type} value={profileForm[key] || ''} onChange={setPf(key)} style={{ width: '100%' }} />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {[
                        ['Contact person', 'name', 'text'],
                        ['Email', 'email', 'email'],
                        ['Phone', 'phone', 'tel'],
                        ['Business name', 'business_name', 'text'],
                        ['Business type', 'business_type', 'text'],
                        ['VAT number', 'vat_number', 'text'],
                        ['Website / social', 'website', 'text'],
                      ].map(([label, key, type]) => (
                        <div key={key}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</label>
                          <input className="adm-field-input" type={type} value={profileForm[key] || ''} onChange={setPf(key)} style={{ width: '100%' }} />
                        </div>
                      ))}
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Customer code</label>
                        <input
                          className="adm-field-input"
                          value={profileForm.customer_code || ''}
                          onChange={(e) => setProfileForm((f) => ({ ...f, customer_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }))}
                          placeholder="6-character code"
                          maxLength={6}
                          style={{ width: '100%', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em' }}
                        />
                        <span style={{ display: 'block', fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                          {profileCustomer.customer_code
                            ? 'A code is already set. Changing it will not resend the email.'
                            : 'Leave blank to allocate later. Saving a code sends the confirmation email.'}
                        </span>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Monthly spend</label>
                        <select className="adm-field-input" value={profileForm.monthly_spend || ''} onChange={setPf('monthly_spend')} style={{ width: '100%' }}>
                          <option value="">—</option>
                          {SPEND_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      {[['Company address', 'company_address'], ['Delivery address', 'delivery_address']].map(([label, key]) => (
                        <div key={key}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</label>
                          <textarea className="adm-field-input" rows={2} value={profileForm[key] || ''} onChange={setPf(key)} style={{ width: '100%', resize: 'vertical' }} />
                        </div>
                      ))}
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button className="adm-btn-green" onClick={() => void saveProfileEdit()} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</button>
                    <button className="adm-btn-ghost" onClick={() => setProfileEditing(false)} disabled={savingProfile}>Cancel</button>
                  </div>
                </div>
              ) : (
                <section className="adm-account-details" aria-labelledby="customer-account-heading">
                  <h3 id="customer-account-heading">Current account details</h3>
                  <div className="adm-drawer-fields">
                  <DrawerField icon={User} label="Contact person" value={profileCustomer.contact_name || profileCustomer.name} />
                  <DrawerField icon={Mail} label="Email" value={profileCustomer.email} />
                  {profileSource !== 'proto-active' && <DrawerField icon={Phone} label="Phone" value={profileCustomer.phone} />}
                  <DrawerField icon={Building2} label="Customer code" value={profileCustomer.customer_code || profileCustomer.account_code} />
                  {profileCustomer.first_name && <DrawerField icon={User} label="First name" value={profileCustomer.first_name} />}
                  {profileCustomer.sales_last_12_months != null && (
                    <DrawerField icon={Store} label="12mo sales" value={`R${Number(profileCustomer.sales_last_12_months).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`} />
                  )}
                  {profileCustomer.invoice_count != null && (
                    <DrawerField icon={Store} label="Invoices (12mo)" value={String(profileCustomer.invoice_count)} />
                  )}
                  {profileCustomer.last_purchase_date && (
                    <DrawerField icon={Building2} label="Last purchase" value={new Date(profileCustomer.last_purchase_date).toLocaleDateString('en-ZA')} />
                  )}
                  </div>
                </section>
              )}

              {profileSource !== 'proto-active' && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, fontFamily: 'Outfit, sans-serif' }}>Order History</div>
                {profileOrdersLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                    <Loader2 size={14} className="spin" /> Loading orders…
                  </div>
                )}
                {!profileOrdersLoading && profileOrders.length === 0 && (
                  <div className="adm-muted" style={{ fontSize: 13 }}>No orders found.</div>
                )}
                {!profileOrdersLoading && profileOrders.length > 0 && (
                  <div className="adm-profile-orders">
                    {profileOrders.map((order) => (
                      <div key={order.id} className="adm-profile-order">
                        <div className="adm-profile-order-head">
                          <span>{order.order_number || order.id.slice(0, 8)}</span>
                          <span className="adm-pill" style={{ fontSize: 10, padding: '2px 8px' }}>{order.status || 'pending'}</span>
                          <span className="adm-muted">{new Date(order.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                        <div className="adm-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {compactItems(order.original_items || order.items || [])}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
            <div className="adm-drawer-footer">
              <button onClick={closeCustomerProfile} className="adm-btn-ghost">Close</button>
              {profileSource !== 'proto-active' && !profileCustomer.is_approved && (
                <>
                  <input
                    type="text"
                    className="adm-tiny-input"
                    placeholder="Code (optional)"
                    maxLength={6}
                    value={approvalCodes[profileCustomer.id] || ''}
                    onChange={(e) => setApprovalCodes((prev) => ({
                      ...prev,
                      [profileCustomer.id]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
                    }))}
                    title="Optional. Type a 6-character code to send the confirmation email now, or leave blank and allocate it later."
                    style={{ width: 108, fontFamily: 'monospace', fontWeight: 700 }}
                  />
                  <button
                    onClick={() => void approveRequest(profileCustomer)}
                    className="adm-btn-green"
                    disabled={saving === profileCustomer.id
                      || (!!approvalCodes[profileCustomer.id] && !/^[A-Z0-9]{6}$/.test(approvalCodes[profileCustomer.id]))}
                  >
                    {saving === profileCustomer.id ? 'Approving…' : <><Check size={15} /> Approve</>}
                  </button>
                </>
              )}
              {profileSource !== 'proto-active' && (
                <button onClick={() => void deactivateCustomer(profileCustomer)} className="adm-btn-ghost" disabled={saving === `deact-${profileCustomer.id}`}>
                  {saving === `deact-${profileCustomer.id}` ? '…' : 'Deactivate'}
                </button>
              )}
              <button
                onClick={() => void removeCustomer(profileCustomer, profileSource)}
                className="adm-btn-ghost"
                style={{ color: '#c40000' }}
                disabled={saving === (profileSource === 'proto-active' ? `del-proto-${profileCustomer.id}` : `del-${profileCustomer.id}`)}
              >
                {saving === (profileSource === 'proto-active' ? `del-proto-${profileCustomer.id}` : `del-${profileCustomer.id}`) ? '…' : <><Trash2 size={14} /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {customerEmailOpen && (
        <Suspense fallback={null}>
          <CustomerEmailModal
            open={customerEmailOpen}
            onClose={() => { setCustomerEmailOpen(false); setComposeTarget(null); }}
            customerTab={customerTab}
            onSend={sendCustomerEmailBroadcast}
            onShowToast={showToast}
            adminEmail={customer?.email || ''}
            initialAudience={composeTarget?.audience || null}
            initialBusinessTypes={composeTarget?.businessTypes || null}
            initialRecipients={composeTarget?.recipients || null}
          />
        </Suspense>
      )}

      {addCustomerOpen && (
        <AddCustomerModal
          open={addCustomerOpen}
          onClose={() => setAddCustomerOpen(false)}
          onShowToast={showToast}
          onAdded={() => { void loadCustomers(); }}
        />
      )}

      <TaxonomyModals
        taxonomyTree={taxonomyTree}
        editModal={editTaxonomyModal}
        deleteModal={deleteSubModal}
        newSubModal={newSubModal}
        newCategoryModal={newCategoryModal}
        saving={taxonomySaving}
        onCloseEdit={() => setEditTaxonomyModal(null)}
        onCloseDelete={() => setDeleteSubModal(null)}
        onCloseNewSub={() => setNewSubModal(null)}
        onCloseNewCategory={() => setNewCategoryModal(null)}
        onEditLabelChange={(label) => setEditTaxonomyModal((m) => ({ ...m, label }))}
        onNewSubParentChange={(parentId) => setNewSubModal((m) => ({ ...m, parentId }))}
        onNewSubLabelChange={(label) => setNewSubModal((m) => ({ ...m, label }))}
        onNewCategoryLabelChange={(label) => setNewCategoryModal((m) => ({ ...m, label }))}
        onSaveRename={saveTaxonomyRename}
        onConfirmDelete={confirmDeleteSubcategory}
        onSaveNewSub={saveNewSubcategory}
        onSaveNewCategory={saveNewCategory}
      />

      {/* Content quick-edit modal (image drag-drop + description) */}
      {contentEditProduct && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal" style={{ maxWidth: 580 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, fontFamily: 'Outfit, sans-serif' }}>Edit image & description</h3>
                <p className="adm-muted" style={{ marginTop: 4, fontSize: 13 }}>{contentEditProduct.name}</p>
              </div>
              <button onClick={closeContentEdit} className="adm-icon-btn"><X size={16} /></button>
            </div>

            {/* Hidden file input */}
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImageFile(f); e.target.value = ''; }}
            />

            {/* Drop zone / preview */}
            <div
              onClick={() => !imageUploading && imageFileInputRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); setImageDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setImageDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setImageDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setImageDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void uploadImageFile(file);
              }}
              style={{
                position: 'relative',
                marginBottom: 12,
                borderRadius: 10,
                border: `2px dashed ${imageDragOver ? '#8B1A1A' : contentEditForm.image ? '#d1d5db' : '#cbd5e1'}`,
                background: imageDragOver ? '#fff5f5' : contentEditForm.image ? '#f8f8f8' : '#f8fafc',
                height: 220,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: imageUploading ? 'wait' : 'pointer',
                overflow: 'hidden',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {imageUploading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#8B1A1A' }}>
                  <Loader2 size={32} className="spin" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Uploading…</span>
                </div>
              ) : contentEditForm.image ? (
                <>
                  <img
                    src={contentEditForm.image}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
                    display: imageDragOver ? 'flex' : 'none',
                    alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#fff',
                  }}>
                    <Upload size={28} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Drop to replace</span>
                  </div>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '6px 10px', background: 'rgba(0,0,0,0.5)',
                    color: '#fff', fontSize: 11, textAlign: 'center',
                    display: imageDragOver ? 'none' : 'block',
                  }}>
                    Click or drag a new image to replace
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: imageDragOver ? '#8B1A1A' : '#94a3b8', pointerEvents: 'none' }}>
                  <Upload size={32} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Drag & drop an image here</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>or click to browse files</div>
                  </div>
                </div>
              )}
            </div>

            {/* Manual URL input */}
            <label style={{ display: 'grid', gap: 5, marginBottom: 18 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Or paste image URL</span>
              <input
                value={contentEditForm.image}
                onChange={(e) => setContentEditForm((f) => ({ ...f, image: e.target.value }))}
                className="adm-field-input"
                placeholder="https://example.com/product.jpg"
                style={{ fontSize: 12 }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Website SKU (WSK)</span>
                <input
                  value={contentEditProduct?.websiteSku || ''}
                  readOnly
                  className="adm-field-input"
                  style={{ fontSize: 12, background: '#f8fafc', color: '#64748b', cursor: 'default' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Barcode (BC)</span>
                <input
                  value={contentEditForm.code || ''}
                  onChange={(e) => setContentEditForm((f) => ({ ...f, code: e.target.value }))}
                  className="adm-field-input"
                  placeholder="Product barcode"
                  style={{ fontSize: 12 }}
                />
              </label>
            </div>

            {/* Description */}
            <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Description</span>
              <textarea
                value={contentEditForm.description}
                onChange={(e) => setContentEditForm((f) => ({ ...f, description: e.target.value }))}
                className="adm-field-input"
                rows={4}
                placeholder="Product description shown to customers…"
                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6, marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Pack Description</span>
              <textarea
                value={contentEditForm.packDescription || ''}
                onChange={(e) => setContentEditForm((f) => ({ ...f, packDescription: e.target.value }))}
                className="adm-field-input"
                rows={2}
                placeholder="Pack / carton description…"
                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </label>

            <div style={{ marginBottom: 20 }}>
              <SellingUnitField
                value={contentEditForm.unitsOfIssue}
                onChange={(unitsOfIssue) => setContentEditForm((form) => ({ ...form, unitsOfIssue }))}
                id="content-edit-selling-unit-options"
              />
            </div>

            {contentEditError && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, color: '#c40000', fontSize: 13 }}>
                {contentEditError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={closeContentEdit} className="adm-btn-ghost"><ChevronLeft size={15} /> Cancel</button>
              <button onClick={() => void saveContentEdit()} className="adm-btn-red" disabled={contentEditSaving || imageUploading}>
                {contentEditSaving ? 'Saving…' : <><Check size={15} /> Save to Supabase</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfillment modal */}
      {fulfillmentOrder && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal" style={{ maxWidth: 740, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, fontFamily: 'Outfit, sans-serif', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClipboardList size={20} style={{ color: '#15803d' }} /> Order Fulfillment
                </h3>
                <p className="adm-muted" style={{ marginTop: 4, fontSize: 13 }}>
                  {fulfillmentOrder.order_number || fulfillmentOrder.id.slice(0, 8)} &nbsp;·&nbsp; {new Date(fulfillmentOrder.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <button onClick={closeFulfillment} className="adm-icon-btn"><X size={16} /></button>
            </div>

            {/* Customer details */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{fulfillmentOrder.customers?.name || 'Unknown customer'}</div>
              <div className="adm-muted" style={{ marginTop: 2 }}>{fulfillmentOrder.customers?.email || '—'}</div>
            </div>

            {/* Items table */}
            <div style={{ overflowY: 'auto', flex: 1, marginBottom: 14 }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '28px 24px 52px 90px 1fr 64px 72px 32px', gap: '0 8px', padding: '6px 8px', background: '#f1f5f9', borderRadius: 6, marginBottom: 4, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', alignItems: 'center' }}>
                <span>✓</span><span>#</span><span>Img</span><span>Code</span><span>Product</span><span>Ordered</span><span>Final qty</span><span></span>
              </div>
              {fulfillmentItems.map((item, idx) => (
                <div key={idx}>
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 24px 52px 90px 1fr 64px 72px 32px', gap: '0 8px', padding: '8px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', background: item.checked ? '#f0fdf4' : 'white' }}>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => setFulfillmentItems((prev) => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it))}
                      style={{ width: 16, height: 16, accentColor: '#15803d', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>{idx + 1}</span>
                    <div style={{ width: 48, height: 48, borderRadius: 6, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {item.image
                        ? <img src={item.image} alt="" style={{ width: 48, height: 48, objectFit: 'contain', mixBlendMode: 'multiply' }} />
                        : <span style={{ fontSize: 9, color: '#9ca3af' }}>IMG</span>}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 12, wordBreak: 'break-all' }}>{item.code || '—'}</span>
                    <span style={{ fontSize: 13 }}>{item.name || '—'}</span>
                    <span style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>× {item.qty}</span>
                    <input
                      type="number"
                      min="0"
                      value={item.finalQty}
                      onChange={(e) => setFulfillmentItems((prev) => prev.map((it, i) => i === idx ? { ...it, finalQty: Math.max(0, Number(e.target.value)) } : it))}
                      className="adm-tiny-input"
                      style={{ width: 64, textAlign: 'center' }}
                    />
                    <button
                      onClick={() => { setEditingItemIdx(editingItemIdx === idx ? null : idx); setProductSwapSearch(''); setProductSwapResults([]); }}
                      className="adm-icon-btn"
                      title="Swap product"
                      style={{ color: editingItemIdx === idx ? '#8B1A1A' : undefined }}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>

                  {/* Inline product swap */}
                  {editingItemIdx === idx && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, margin: '4px 0 8px', display: 'grid', gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#92400e' }}>Swap product — search by code or name</div>
                      <label className="adm-search" style={{ background: 'white' }}>
                        <Search size={13} />
                        <input
                          value={productSwapSearch}
                          onChange={(e) => handleSwapSearchChange(e.target.value)}
                          placeholder="Type code or product name…"
                          className="adm-search-input"
                          autoFocus
                        />
                        {productSwapLoading && <Loader2 size={13} className="spin" />}
                      </label>
                      {productSwapResults.length > 0 && (
                        <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                          {productSwapResults.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => swapFulfillmentItem(idx, p)}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                            >
                              {p.image
                                ? <img src={p.image} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                                : <div style={{ width: 36, height: 36, background: '#f3f4f6', borderRadius: 4, flexShrink: 0 }} />}
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 12 }}>{p.code}</div>
                                <div style={{ color: '#374151' }}>{p.name}</div>
                              </div>
                              <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>R{p.price}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {productSwapSearch && !productSwapLoading && productSwapResults.length === 0 && (
                        <div className="adm-muted" style={{ fontSize: 12 }}>No products found.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ flexShrink: 0, marginBottom: 16 }}>
              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Notes</span>
                <textarea
                  value={fulfillmentNotes}
                  onChange={(e) => setFulfillmentNotes(e.target.value)}
                  className="adm-field-input"
                  rows={4}
                  placeholder={'Add clear notes, one point per line…\nExample:\nCustomer approved substitution\nDeliver with next stock run'}
                  style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                />
              </label>
              <div style={{ marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Notes preview</div>
                {renderNoteSections(fulfillmentNoteSections)}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
              <button onClick={closeFulfillment} className="adm-btn-ghost"><ChevronLeft size={15} /> Cancel</button>
              <button onClick={() => void saveFulfillment()} className="adm-btn-red" disabled={fulfillmentSaving}>
                {fulfillmentSaving ? 'Saving…' : <><Check size={15} /> Save order</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {imageViewUrl && (
        <div
          onClick={() => setImageViewUrl('')}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={imageViewUrl}
            alt="Product"
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setImageViewUrl('')}
            style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Product editor modal */}
      {editorOpen && (
        <div className="adm-modal-backdrop" onClick={closeEditor}>
          <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 22, fontFamily: 'Outfit, sans-serif' }}>{editingProduct ? 'Edit product' : 'Add product'}</h3>
                <p className="adm-muted" style={{ marginTop: 4 }}>Fill in the details and assign a category.</p>
              </div>
              <button onClick={closeEditor} className="adm-icon-btn"><X size={16} /></button>
            </div>

            <div style={{ overflowY: 'auto', paddingRight: 4, flex: 1, minHeight: 0 }}>

            {PRODUCT_IMAGE_SLOTS.map((slot) => (
              <input
                key={`file-${slot.key}`}
                ref={(el) => { editorImageFileInputRefs.current[slot.key] = el; }}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadEditorImageFile(file, slot.key);
                  e.target.value = '';
                }}
              />
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              <AdminField label="Product code"><input type="text" value={productForm.code} onChange={(e) => setProductForm((p) => ({ ...p, code: e.target.value }))} className="adm-field-input" /></AdminField>
              <AdminField label="Product name" full><input type="text" value={productForm.name} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} className="adm-field-input" /></AdminField>
              <AdminField label="Description" full>
                <textarea value={productForm.description} onChange={(e) => setProductForm((p) => ({ ...p, description: e.target.value }))} className="adm-field-input" rows={3} style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} placeholder="Product description shown to customers…" />
              </AdminField>
              <AdminField label="Pack Description" full>
                <textarea value={productForm.packDescription} onChange={(e) => setProductForm((p) => ({ ...p, packDescription: e.target.value }))} className="adm-field-input" rows={2} style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} placeholder="Pack / carton description…" />
              </AdminField>
              <SellingUnitField
                value={productForm.unitsOfIssue}
                onChange={(unitsOfIssue) => setProductForm((product) => ({ ...product, unitsOfIssue }))}
                id="product-editor-selling-unit-options"
              />
              <AdminField label="Minimum order quantity">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="9999"
                  step="1"
                  value={productForm.minQty}
                  onChange={(e) => setProductForm((product) => ({ ...product, minQty: e.target.value }))}
                  className="adm-field-input"
                />
                <p className="adm-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                  Number of selling units required. Example: Pack 10 with minimum 3 means the customer orders at least 3 packs.
                </p>
              </AdminField>

              <AdminField label="Product images (up to 4)" full>
                <p className="adm-muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                  Best size: 800×800 px square, white background, product centred — matches your resize script and catalog cards.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {PRODUCT_IMAGE_SLOTS.map((slot, slotIndex) => {
                    const value = productForm[slot.key];
                    const isDragOver = editorImageDragOver === slot.key;
                    const nextKey = PRODUCT_IMAGE_SLOTS[slotIndex + 1]?.key;
                    return (
                      <div key={slot.key} style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{slot.label}</span>
                          {nextKey && (
                            <button
                              type="button"
                              onClick={() => swapEditorImageSlots(slotIndex)}
                              className="adm-btn-ghost"
                              style={{ padding: '6px 10px', fontSize: 12 }}
                              disabled={!productForm[slot.key] && !productForm[nextKey]}
                            >
                              Swap {slotIndex + 1} ↔ {slotIndex + 2}
                            </button>
                          )}
                        </div>
                        <div
                          onClick={() => !editorImageUploading && editorImageFileInputRefs.current[slot.key]?.click()}
                          onDragEnter={(e) => { e.preventDefault(); setEditorImageDragOver(slot.key); }}
                          onDragOver={(e) => { e.preventDefault(); setEditorImageDragOver(slot.key); }}
                          onDragLeave={(e) => { e.preventDefault(); if (editorImageDragOver === slot.key) setEditorImageDragOver(''); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setEditorImageDragOver('');
                            const file = e.dataTransfer.files?.[0];
                            if (file) void uploadEditorImageFile(file, slot.key);
                          }}
                          style={{
                            position: 'relative',
                            minHeight: 160,
                            borderRadius: 16,
                            border: `2px dashed ${isDragOver ? '#8B1A1A' : value ? '#d1d5db' : '#cbd5e1'}`,
                            background: isDragOver ? '#fff5f5' : '#f8fafc',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: editorImageUploading ? 'wait' : 'pointer',
                            overflow: 'hidden',
                            transition: 'border-color 0.15s, background 0.15s',
                          }}
                        >
                          {editorImageUploading && isDragOver ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#8B1A1A' }}>
                              <Loader2 size={32} className="spin" />
                              <span style={{ fontSize: 13, fontWeight: 600 }}>Uploading image…</span>
                            </div>
                          ) : value ? (
                            <>
                              <img src={value} alt={`${slot.label} preview`} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: isDragOver ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#fff' }}>
                                <Upload size={28} />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>Drop to replace image</span>
                              </div>
                              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 12px', background: 'rgba(15, 23, 42, 0.55)', color: '#fff', fontSize: 12, textAlign: 'center' }}>
                                Click or drag a new image here to replace it
                              </div>
                            </>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: isDragOver ? '#8B1A1A' : '#64748b', pointerEvents: 'none', textAlign: 'center', padding: 20 }}>
                              <Upload size={32} />
                              <div style={{ fontWeight: 700, fontSize: 15 }}>Drag & drop image here</div>
                              <div style={{ fontSize: 12 }}>or click to browse and upload it to Supabase</div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => editorImageFileInputRefs.current[slot.key]?.click()} className="adm-btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} disabled={editorImageUploading}>
                            Upload
                          </button>
                          {value && (
                            <button type="button" onClick={() => clearEditorImage(slot.key)} className="adm-btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} disabled={editorImageUploading}>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </AdminField>

              {PRODUCT_IMAGE_SLOTS.map((slot) => (
                <AdminField key={`url-${slot.key}`} label={`${slot.label} URL`} full>
                  <input
                    type="text"
                    value={productForm[slot.key]}
                    onChange={(e) => setProductForm((p) => ({ ...p, [slot.key]: e.target.value }))}
                    className="adm-field-input"
                  />
                </AdminField>
              ))}
              <AdminField label="Price"><input type="text" inputMode="decimal" value={productForm.price} onChange={(e) => setProductForm((p) => ({ ...p, price: e.target.value }))} className="adm-field-input" /></AdminField>
              {/* SOH comes from the ERP sync — an editable field here silently discarded input. */}
              <AdminField label="Stock on hand (synced from ERP)"><input type="text" value={productForm.stockOnHand} readOnly disabled className="adm-field-input" title="Stock on hand is synced from the ERP and cannot be edited here" /></AdminField>
              {/* Live-catalogue flags (moved here from the row buttons). Applied on
                  Save; only shown for live products. */}
              {editingProduct && !editingProduct.archivedBy && (
                <AdminField label="Homepage & ordering" full>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={!!productForm.isNewArrival} onChange={(e) => setProductForm((p) => ({ ...p, isNewArrival: e.target.checked }))} />
                      <span>Show in the <strong>New Stock</strong> ribbon on the homepage</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={!!productForm.toOrder} onChange={(e) => setProductForm((p) => ({ ...p, toOrder: e.target.checked }))} />
                      <span><strong>Made / sourced to order</strong> — customers can order this at zero stock and will see an extra-lead-time disclaimer</span>
                    </label>

                    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'grid', gap: 10 }}>
                      <div>
                        <strong style={{ fontSize: 13 }}>Incoming container stock</strong>
                        <p className="adm-muted" style={{ margin: '3px 0 0', fontSize: 12 }}>
                          Separate from made-to-order. ERP stock remains the exact stock-on-hand source.
                        </p>
                      </div>
                      {productForm.availabilityLoading ? (
                        <span className="adm-muted" style={{ fontSize: 12 }}>Loading availability…</span>
                      ) : productForm.availabilitySchemaReady === false ? (
                        <span style={{ fontSize: 12, color: '#b45309', fontWeight: 700 }}>Migration 059 is required before incoming stock can be saved.</span>
                      ) : (
                        <>
                          <select
                            className="adm-field-input"
                            value={productForm.incomingStatus}
                            onChange={(e) => setProductForm((p) => ({
                              ...p,
                              incomingStatus: e.target.value,
                              ...(e.target.value === 'none' ? {
                                incomingQty: '', incomingEta: '', shipmentRef: '', allowPreorder: false,
                              } : {}),
                            }))}
                            aria-label="Incoming stock status"
                          >
                            <option value="none">No incoming stock</option>
                            <option value="on_the_way">On the way</option>
                            <option value="customs">In customs</option>
                            <option value="landed_awaiting_grv">Landed — awaiting GRV</option>
                            <option value="partially_received">Partially received</option>
                          </select>
                          {productForm.incomingStatus !== 'none' && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                              <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
                                Expected quantity
                                <input className="adm-field-input" type="number" min="0.001" step="0.001" value={productForm.incomingQty} onChange={(e) => setProductForm((p) => ({ ...p, incomingQty: e.target.value }))} />
                              </label>
                              <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
                                ETA
                                <input className="adm-field-input" type="date" value={productForm.incomingEta} onChange={(e) => setProductForm((p) => ({ ...p, incomingEta: e.target.value }))} />
                              </label>
                              <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700, gridColumn: '1 / -1' }}>
                                Container / shipment reference
                                <input className="adm-field-input" type="text" maxLength="120" value={productForm.shipmentRef} onChange={(e) => setProductForm((p) => ({ ...p, shipmentRef: e.target.value }))} placeholder="Optional internal reference" />
                              </label>
                            </div>
                          )}
                          {['on_the_way', 'customs'].includes(productForm.incomingStatus) && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                              <input type="checkbox" checked={!!productForm.allowPreorder} onChange={(e) => setProductForm((p) => ({ ...p, allowPreorder: e.target.checked }))} />
                              <span>Allow customers to pre-order before the shipment lands</span>
                            </label>
                          )}
                          {['landed_awaiting_grv', 'partially_received'].includes(productForm.incomingStatus) && (
                            <span style={{ fontSize: 12, color: '#245aa7', fontWeight: 700 }}>
                              Customers can order this while receiving is completed; the quote confirms final quantity.
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </AdminField>
              )}
              {/*
                Cascading category pickers — Main, then Child 1..N as deep as the
                taxonomy tree goes (no fixed depth cap). Each level renders only
                while its parent has a value and there are options to choose (or
                a stale value to preserve) — the loop stops the moment a level
                would render nothing, which also naturally offers exactly one
                more empty picker at the deepest populated level.
                Hidden for archived products — category is chosen at Make live instead.
              */}
              {!editingProduct?.archivedBy && (
              <>
              <AdminField label="Main category" full>
                <select
                  value={productForm.categoryId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const firstChild = subcategoryOptions(nextId, taxonomyTree)[0]?.id || '';
                    setProductForm((p) => ({
                      ...p,
                      categoryId: nextId,
                      childIds: firstChild ? [firstChild] : [],
                    }));
                  }}
                  className="adm-field-input"
                >
                  {mainCategories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </AdminField>

              {(() => {
                const childIds = productForm.childIds || [];
                const fields = [];
                let parentId = productForm.categoryId;
                for (let level = 1; parentId; level += 1) {
                  const rawOptions = level === 1
                    ? subcategoryOptions(productForm.categoryId, taxonomyTree)
                    : childrenOf(taxonomyTree, parentId);
                  const currentValue = childIds[level - 1] || '';
                  const options = withCurrentOption(rawOptions, currentValue);
                  if (!options.length) break;
                  fields.push({ level, options, currentValue });
                  parentId = currentValue;
                }
                return fields.map(({ level, options, currentValue }) => (
                  <AdminField key={level} label={`Child category ${level}`}>
                    <select
                      value={currentValue}
                      onChange={(e) => setProductForm((p) => ({
                        ...p,
                        childIds: [...(p.childIds || []).slice(0, level - 1), e.target.value].filter(Boolean),
                      }))}
                      className="adm-field-input"
                    >
                      <option value="">— None —</option>
                      {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </AdminField>
                ));
              })()}
              </>
              )}
            </div>
            {/* Extra categories are stored separately from the product row, so
                they are only editable once the product exists.

                MUST stay inside the scrollable body above. Outside it, the
                panel sits in the modal's fixed region and pushes its own Add
                button past maxHeight: 92vh, where it cannot be clicked. */}
            {editingProduct?.sku && (
              <div style={{ marginTop: 14 }}>
                <PlacementsEditor websiteSku={editingProduct.sku} taxonomyTree={taxonomyTree} />
              </div>
            )}
            </div>
            {editorError && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, color: '#c40000', fontSize: 13, flexShrink: 0 }}>
                {editorError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
              <button type="button" onClick={closeEditor} className="adm-btn-ghost"><ChevronLeft size={15} /> Cancel</button>
              <button type="button" onClick={() => void saveProduct()} className="adm-btn-red" disabled={editorImageUploading}>
                {saving === 'new-product' || saving === editingProduct?.id ? 'Saving…' : <><Check size={15} /> Save product</>}
              </button>
            </div>
          </div>
        </div>
      )}


      {fulfillmentSettingsOpen && (
        <Suspense fallback={null}>
          <FulfillmentSettingsModal
            open={fulfillmentSettingsOpen}
            taxonomyTree={taxonomyTree}
            onClose={(saved) => {
              setFulfillmentSettingsOpen(false);
              if (saved) void fetchFulfillmentUsers().then(setFulfillmentUsers);
            }}
          />
        </Suspense>
      )}

      {toast && (
        <div className={`adm-toast adm-toast--${toast.type}`} role="status">{toast.message}</div>
      )}
    </div>
  );
}

function OrderItemsList({ label, items }) {
  return (
    <div className="adm-subtle-box">
      <strong style={{ fontSize: 12 }}>{label}</strong>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0 && <span className="adm-muted" style={{ fontSize: 12 }}>—</span>}
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 5, background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {item.image
                ? <img src={item.image} alt="" style={{ width: 40, height: 40, objectFit: 'contain', mixBlendMode: 'multiply' }} />
                : <span style={{ fontSize: 8, color: '#9ca3af' }}>IMG</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: '#374151' }}>{item.code}</div>
              <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.name}</div>
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, flexShrink: 0 }}>× {item.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminField({ label, children, full = false }) {
  return (
    <label style={{ display: 'grid', gap: 6, gridColumn: full ? '1 / -1' : undefined }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}

function DrawerField({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="adm-drawer-field">
      <Icon size={14} className="adm-drawer-field-icon" />
      <div>
        <div className="adm-drawer-field-label">{label}</div>
        <div className="adm-drawer-field-value">{value}</div>
      </div>
    </div>
  );
}

function AdminStat({ label, value, accent }) {
  const display = typeof value === 'object' ? '—' : value;
  return (
    <div className={`adm-stat${accent ? ' adm-stat--accent' : ''}`}>
      <div className="adm-stat-value">{display}</div>
      <div className="adm-stat-label">{label}</div>
    </div>
  );
}

function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20 }}>
      <button onClick={() => onChange(Math.max(1, page - 1))} className="adm-btn-ghost" disabled={page <= 1}><ChevronLeft size={15} /> Prev</button>
      <span className="adm-muted">Page {page} of {totalPages}</span>
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} className="adm-btn-ghost" disabled={page >= totalPages}>Next <ChevronRight size={15} /></button>
    </div>
  );
}
