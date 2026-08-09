import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  FolderOpen,
  ImagePlus,
  Loader2,
  PackagePlus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import categories from '../data/categories.json';
import { isImageFile } from '../lib/parseIntakeFilename.js';
import { readApiJson } from '../lib/apiError.js';
import ProductLoaderNutstore from './productLoader/ProductLoaderNutstore';
import ProductLoaderDormantQueue from './productLoader/ProductLoaderDormantQueue';
import ProductLoaderUpload from './productLoader/ProductLoaderUpload';
import ProductLoaderPublishSuccess from './productLoader/ProductLoaderPublishSuccess';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import { catalogueDisplayTitle, catalogueDescription } from '../lib/productLoaderDisplay.js';

const LOADER_TABS = [
  { id: 'nutstore', label: 'Nutstore' },
  { id: 'image-centre', label: 'Image Processing Centre' },
  { id: 'upload', label: 'Upload' },
];

// Maps Gemini's category labels to taxonomy IDs
const GEMINI_CATEGORY_MAP = {
  'Arts Crafts & Stationery': 'arts-crafts-stationery',
  'Beads Jewellery & Accessories': 'beads-jewellery-accessories',
  'Beauty & Personal Care': 'beauty-personal-care',
  'Events & Parties': 'events-parties',
  'Fashion & Accessories': 'fashion-accessories',
  'Food & Drinks': 'food-drinks',
  'Hardware': 'hardware',
  'Homeware & Kitchen': 'homeware-kitchen',
  'Packaging': 'packaging',
  'Textiles': 'textiles',
  'Toys Games & Kids': 'toys-games-kids',
};

const SLOT_FIELDS = ['image_url_one', 'image_url_two', 'image_url_three', 'image_url_four'];

function categoryLabelsFromIds(tree, categoryId, sub1Id, sub2Id, sub3Id = '', sub4Id = '') {
  const catNode = findNode(tree, categoryId);
  const sub1Node = findNode(tree, sub1Id);
  const sub2Node = findNode(tree, sub2Id);
  const sub3Node = findNode(tree, sub3Id);
  const sub4Node = findNode(tree, sub4Id);
  return {
    category: catNode?.label || '',
    subcategoryOne: sub1Node?.label || catNode?.label || '',
    subcategoryTwo: sub2Node?.label || null,
    subcategoryThree: sub3Node?.label || null,
    subcategoryFour: sub4Node?.label || null,
  };
}

function normalizeRowLabel(label) {
  return String(label || '').trim().toLowerCase();
}

function idsFromRowLabels(tree, row) {
  const out = { categoryId: '', sub1Id: '', sub2Id: '', sub3Id: '', sub4Id: '' };
  const cat = tree.find((c) => normalizeRowLabel(c.label) === normalizeRowLabel(row.category));
  if (!cat) return out;
  out.categoryId = cat.id;

  const labels = [
    row.subcategoryOne ?? row.subcategory_one,
    row.subcategoryTwo ?? row.subcategory_two,
    row.subcategoryThree ?? row.subcategory_three,
    row.subcategoryFour ?? row.subcategory_four,
  ].filter(Boolean);

  let children = cat.children || [];
  const keys = ['sub1Id', 'sub2Id', 'sub3Id', 'sub4Id'];
  for (let i = 0; i < labels.length && i < keys.length; i += 1) {
    const child = children.find((c) => normalizeRowLabel(c.label) === normalizeRowLabel(labels[i]));
    if (!child) break;
    out[keys[i]] = child.id;
    children = child.children || [];
  }
  return out;
}

async function dormantApi(body) {
  const res = await fetch('/api/product-loader-dormant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Dormant request failed');
  return json;
}

function findNode(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

function childrenOf(tree, id) {
  return findNode(tree, id)?.children || [];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function WarnBanner({ msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
      <AlertTriangle size={13} style={{ flexShrink: 0 }} />
      {msg}
    </div>
  );
}

function SectionHead({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
      {action}
    </div>
  );
}

export default function ProductLoaderPanel({
  taxonomyTree = categories,
  onShowToast,
  initialCode = '',
  onInitialCodeConsumed,
  mainSiteUrl = 'https://site.proto.co.za',
  publishedBy = '',
}) {
  const [activeTab, setActiveTab] = useState('nutstore');
  const [publishSuccess, setPublishSuccess] = useState(null);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const singleImageRef = useRef(null);

  const [batchItems, setBatchItems] = useState([]);
  const [batchScanning, setBatchScanning] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: '' });
  // Full contiguous category path ids for new/loaded products — [mainId,
  // child1Id, ...] as deep as the taxonomy goes. Deriving the old category/sub1
  // ids keeps the other panel flows working unchanged.
  const [batchDefaultPathIds, setBatchDefaultPathIds] = useState([]);
  const batchDefaultCategoryId = batchDefaultPathIds[0] || '';
  const batchDefaultSub1Id = batchDefaultPathIds[1] || '';
  const [batchOverwrite, setBatchOverwrite] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [singleImageItem, setSingleImageItem] = useState(null);
  const [singleImagePreview, setSingleImagePreview] = useState('');
  const [singleImageScanning, setSingleImageScanning] = useState(false);
  const [singleImageProcessing, setSingleImageProcessing] = useState(false);
  const [singleImageError, setSingleImageError] = useState('');
  const [sqlLiveStatus, setSqlLiveStatus] = useState(null);
  const [nutstoreStatus, setNutstoreStatus] = useState(null);

  const [dormantRows, setDormantRows] = useState([]);
  const [dormantEdits, setDormantEdits] = useState({});
  const [dormantLoading, setDormantLoading] = useState(false);
  const [dormantSaving, setDormantSaving] = useState('');
  const [dormantLoadError, setDormantLoadError] = useState('');
  const [dormantRequested, setDormantRequested] = useState(false);
  const [imageIntakeText, setImageIntakeText] = useState('');
  const [imageIntakeItems, setImageIntakeItems] = useState([]);
  const [imageIntakeLoading, setImageIntakeLoading] = useState(false);
  const [imageIntakeError, setImageIntakeError] = useState('');
  const [imageJobs, setImageJobs] = useState([]);
  const [selectedImageJobId, setSelectedImageJobId] = useState('');
  const [imageJobsLoading, setImageJobsLoading] = useState(false);
  const [imageJobsRequested, setImageJobsRequested] = useState(false);
  const [imageJobsError, setImageJobsError] = useState('');
  const [imageProcessingHealth, setImageProcessingHealth] = useState(null);
  const [imageJobBusy, setImageJobBusy] = useState('');
  const singleProductRef = useRef(null);

  const loadDormant = useCallback(async () => {
    setDormantRequested(true);
    setDormantLoading(true);
    setDormantLoadError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/product-loader-dormant', { signal: controller.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load dormant queue');
      const rows = json.rows || [];
      setDormantRows(rows);
      const edits = {};
      for (const row of rows) {
        edits[row.sku] = idsFromRowLabels(taxonomyTree, row);
      }
      setDormantEdits(edits);
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? 'Image Processing Centre timed out while loading. Retry to load it again.'
        : (err.message || 'Failed to load image processing queue');
      setDormantLoadError(message);
    } finally {
      window.clearTimeout(timeoutId);
      setDormantLoading(false);
    }
  }, [taxonomyTree]);

  const loadImageJobs = useCallback(async () => {
    setImageJobsRequested(true);
    setImageJobsLoading(true);
    setImageJobsError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const [jobsResponse, healthResponse] = await Promise.all([
        fetch('/api/image-processing-jobs?action=list', { signal: controller.signal }),
        fetch('/api/image-processing-jobs?action=health', { signal: controller.signal }),
      ]);
      const jobsJson = await readApiJson(jobsResponse, { fallback: 'Failed to load the image-processing queue' });
      setImageJobs(jobsJson.jobs || []);
      setSelectedImageJobId((current) => (
        (jobsJson.jobs || []).some((job) => job.id === current) ? current : (jobsJson.jobs || [])[0]?.id || ''
      ));
      if (healthResponse.ok) {
        setImageProcessingHealth(await healthResponse.json().catch(() => null));
      } else {
        setImageProcessingHealth(null);
      }
    } catch (err) {
      setImageJobsError(err?.name === 'AbortError'
        ? 'Image Processing Centre timed out while loading. Retry to load it again.'
        : (err.message || 'Failed to load the image-processing queue'));
    } finally {
      window.clearTimeout(timeoutId);
      setImageJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'image-centre') {
      if (!dormantRequested && !dormantLoading) void loadDormant();
      if (!imageJobsRequested && !imageJobsLoading) void loadImageJobs();
    }
  }, [activeTab, dormantRequested, dormantLoading, imageJobsRequested, imageJobsLoading, loadDormant, loadImageJobs]);

  useEffect(() => {
    const onRefresh = (event) => {
      if (event.detail === 'product-loader' && (activeTab === 'image-centre' || dormantRequested)) {
        void loadDormant();
        void loadImageJobs();
      }
    };
    window.addEventListener(ADMIN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, onRefresh);
  }, [activeTab, dormantRequested, loadDormant, loadImageJobs]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/product-loader-diag?code=8626100145')
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setSqlLiveStatus(json); })
      .catch(() => { if (!cancelled) setSqlLiveStatus(null); });
    fetch('/api/nutstore-browse?action=test')
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setNutstoreStatus(json); })
      .catch(() => { if (!cancelled) setNutstoreStatus({ configured: false, connected: false }); });
    return () => { cancelled = true; };
  }, []);

  const [code, setCode] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupData, setLookupData] = useState(null);
  const [matchedBy, setMatchedBy] = useState(null); // 'code' | 'barcode' | null
  const [lookupError, setLookupError] = useState('');

  const [fileObj, setFileObj] = useState(null);
  const [fileBase64, setFileBase64] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageSource, setImageSource] = useState('');
  const [imageSlot, setImageSlot] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [categoryId, setCategoryId] = useState('');
  const [sub1Id, setSub1Id] = useState('');
  const [sub2Id, setSub2Id] = useState('');
  const [sub3Id, setSub3Id] = useState('');
  const [sub4Id, setSub4Id] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [categorySource, setCategorySource] = useState('manual');

  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [priceZeroConfirmed, setPriceZeroConfirmed] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState('');

  const resetLookupDependents = () => {
    setFileObj(null);
    setFileBase64('');
    setImageUrl('');
    setImageSource('');
    setImageSlot(1);
    setCategoryId('');
    setSub1Id('');
    setSub2Id('');
    setSub3Id('');
    setSub4Id('');
    setCategorySource('manual');
    setOverwriteConfirmed(false);
    setPriceZeroConfirmed(false);
    setPublishResult(null);
    setPublishError('');
  };

  const lookupFilenames = async (filenames, files) => {
    const res = await fetch('/api/product-loader-batch-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    });
    const json = await readApiJson(res, { fallback: 'Lookup failed' });
    const fileByName = new Map(files.map((f) => [f.name, f]));
    return (json.items || []).map((item) => ({
      ...item,
      file: fileByName.get(item.filename) || null,
      status: item.canPublish ? 'ready' : 'unmatched',
      processError: '',
    }));
  };

  const publishLoaderImageItem = async (item, { defaultCategoryId, defaultSub1Id, overwrite }) => {
    if (!item?.file || !item.code) throw new Error('Missing image or product code');

    const needsCategory = !item.websiteRow?.category;
    if (needsCategory && !defaultCategoryId) {
      throw new Error('Pick a default category for products not already on the website.');
    }

    const b64 = await fileToBase64(item.file);
    const uploadRes = await fetch('/api/upload-product-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: item.filename,
        contentType: item.file.type || 'image/jpeg',
        base64: b64,
        sku: item.code,
        imageSlot: item.imageSlot,
      }),
    });
    const uploadJson = await readApiJson(uploadRes, { fallback: 'Upload failed' });

    const catId = item.websiteRow?.category
      ? (taxonomyTree.find((c) => c.label === item.websiteRow.category)?.id || defaultCategoryId)
      : defaultCategoryId;
    const sub1IdForItem = item.websiteRow?.subcategory_one
      ? ((findNode(taxonomyTree, catId)?.children || []).find((c) => c.label === item.websiteRow.subcategory_one)?.id || defaultSub1Id)
      : defaultSub1Id;

    const catNode = findNode(taxonomyTree, catId);
    const sub1Node = findNode(taxonomyTree, sub1IdForItem);
    const categoryLabel = catNode?.label || item.websiteRow?.category || '';
    const sub1Label = sub1Node?.label || item.websiteRow?.subcategory_one || categoryLabel;

    if (!categoryLabel) throw new Error('No category available');

    const publishRes = await fetch('/api/product-loader-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: item.code,
        displayCode: item.displayCode,
        title: catalogueDisplayTitle(item),
        price: item.price ?? item.sqlRow?.price ?? 0,
        barcode: item.barcode || item.websiteRow?.barcode || item.code,
        imageUrl: uploadJson.url,
        imageSlot: item.imageSlot,
        imageSource: 'upload',
        overwriteImage: overwrite || item.warnings?.includes('image_exists'),
        category: categoryLabel,
        subcategoryOne: sub1Label,
        subcategoryTwo: item.websiteRow?.subcategory_two || null,
        description: catalogueDescription(item),
        sqlRow: item.sqlRow || null,
        websiteRow: item.websiteRow || null,
        stockQty: item.sqlRow?.onhand ?? item.websiteRow?.stock_qty,
        availableStock: item.sqlRow?.available ?? item.websiteRow?.available_stock,
        categoryConfidence: item.websiteRow ? 1 : 0.5,
        publishMode: 'direct',
      }),
    });
    await readApiJson(publishRes, { fallback: 'Publish failed' });
  };

  const handleSingleImageSelect = async (fileList) => {
    const file = [...(fileList || [])].filter(isImageFile)[0];
    if (!file) {
      setSingleImageError('Please choose an image file.');
      return;
    }

    setSingleImageScanning(true);
    setSingleImageError('');
    setSingleImageItem(null);
    if (singleImagePreview) {
      try { URL.revokeObjectURL(singleImagePreview); } catch { /* ignore */ }
      setSingleImagePreview('');
    }

    try {
      const [item] = await lookupFilenames([file.name], [file]);
      if (!item) throw new Error('Lookup failed');
      setSingleImageItem(item);
      setSingleImagePreview(URL.createObjectURL(file));
      if (item.canPublish) {
        onShowToast?.(`Matched ${item.code} — ${catalogueDisplayTitle(item) || '—'}`, 'success');
      } else {
        onShowToast?.('No catalogue match for that filename', 'warning');
      }
    } catch (err) {
      setSingleImageError(err.message || 'Image lookup failed');
    } finally {
      setSingleImageScanning(false);
    }
  };

  const handleSingleImagePublish = async () => {
    if (!singleImageItem || singleImageItem.status !== 'ready') return;
    setSingleImageProcessing(true);
    setSingleImageError('');
    try {
      await publishLoaderImageItem(singleImageItem, {
        defaultCategoryId: batchDefaultCategoryId,
        defaultSub1Id: batchDefaultSub1Id,
        overwrite: batchOverwrite,
      });
      setSingleImageItem((prev) => (prev ? { ...prev, status: 'done', processError: '' } : prev));
      onShowToast?.(`Published ${singleImageItem.code}`, 'success');
    } catch (err) {
      setSingleImageError(err.message || 'Publish failed');
      setSingleImageItem((prev) => (prev ? { ...prev, status: 'error', processError: err.message } : prev));
    } finally {
      setSingleImageProcessing(false);
    }
  };

  const handleSingleImageDormant = async () => {
    if (!singleImageItem || singleImageItem.status !== 'ready' || !singleImageItem.code) return;
    if (!batchDefaultCategoryId || !batchDefaultSub1Id) {
      setSingleImageError('Pick a default category and subcategory for dormant queue.');
      return;
    }
    const labels = categoryLabelsFromIds(taxonomyTree, batchDefaultCategoryId, batchDefaultSub1Id, '');
    setSingleImageProcessing(true);
    setSingleImageError('');
    try {
      await dormantApi({
        action: 'save',
        code: singleImageItem.code,
        title: catalogueDisplayTitle(singleImageItem),
        price: singleImageItem.price ?? singleImageItem.sqlRow?.price ?? 0,
        description: catalogueDescription(singleImageItem),
        category: singleImageItem.websiteRow?.category || labels.category,
        subcategoryOne: singleImageItem.websiteRow?.subcategory_one || labels.subcategoryOne,
        subcategoryTwo: singleImageItem.websiteRow?.subcategory_two || null,
      });
      await loadDormant();
      onShowToast?.(`Added ${singleImageItem.code} to dormant queue`, 'success');
    } catch (err) {
      setSingleImageError(err.message);
    } finally {
      setSingleImageProcessing(false);
    }
  };

  const clearSingleImage = () => {
    if (singleImagePreview) {
      try { URL.revokeObjectURL(singleImagePreview); } catch { /* ignore */ }
    }
    setSingleImagePreview('');
    setSingleImageItem(null);
    setSingleImageError('');
  };

  const handleFolderSelect = async (fileList) => {
    const files = [...(fileList || [])].filter(isImageFile);
    if (!files.length) {
      setBatchError('No image files found in that folder.');
      return;
    }

    setBatchScanning(true);
    setBatchError('');
    setBatchItems([]);

    try {
      const merged = await lookupFilenames(files.map((f) => f.name), files);
      setBatchItems(merged);
      const matched = merged.filter((i) => i.canPublish).length;
      onShowToast?.(`Matched ${matched} of ${merged.length} images`, 'success');
    } catch (err) {
      setBatchError(err.message || 'Folder scan failed');
    } finally {
      setBatchScanning(false);
    }
  };

  const handleBatchPublish = async () => {
    const ready = batchItems.filter((i) => i.status === 'ready' && i.file && i.code);
    if (!ready.length) return;

    const needsCategory = ready.some((i) => !i.websiteRow?.category);
    if (needsCategory && !batchDefaultCategoryId) {
      setBatchError('Pick a default category for products not already on the website.');
      return;
    }

    setBatchProcessing(true);
    setBatchError('');
    setBatchProgress({ done: 0, total: ready.length, current: '' });

    let ok = 0;
    let failed = 0;

    for (let idx = 0; idx < ready.length; idx += 1) {
      const item = ready[idx];
      setBatchProgress({ done: idx, total: ready.length, current: item.filename });
      setBatchItems((prev) => prev.map((row) => (
        row.filename === item.filename ? { ...row, status: 'processing' } : row
      )));

      try {
        await publishLoaderImageItem(item, {
          defaultCategoryId: batchDefaultCategoryId,
          defaultSub1Id: batchDefaultSub1Id,
          overwrite: batchOverwrite,
        });
        ok += 1;
        setBatchItems((prev) => prev.map((row) => (
          row.filename === item.filename ? { ...row, status: 'done', processError: '' } : row
        )));
      } catch (err) {
        failed += 1;
        setBatchItems((prev) => prev.map((row) => (
          row.filename === item.filename ? { ...row, status: 'error', processError: err.message } : row
        )));
      }
    }

    setBatchProgress({ done: ready.length, total: ready.length, current: '' });
    setBatchProcessing(false);
    onShowToast?.(`Folder done: ${ok} published${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success');
  };

  const removeBatchItem = (filename) => {
    setBatchItems((prev) => prev.filter((row) => row.filename !== filename));
  };

  const clearBatchList = () => {
    setBatchItems([]);
    setBatchError('');
  };

  const saveLookupToDormant = async () => {
    if (!lookupData || !categoryId || !sub1Id) {
      setPublishError('Pick a category and subcategory before saving to dormant.');
      return;
    }
    const labels = categoryLabelsFromIds(taxonomyTree, categoryId, sub1Id, sub2Id, sub3Id, sub4Id);
    setDormantSaving('single');
    setPublishError('');
    try {
      await dormantApi({
        action: 'save',
        code: websiteRow?.sku || code,
        title: catalogueDisplayTitle({ code, title: sqlRow?.title, sqlRow, websiteRow }),
        price: sqlRow?.price ?? websiteRow?.price ?? 0,
        description: catalogueDescription({ code, sqlRow, websiteRow }),
        ...labels,
      });
      await loadDormant();
      onShowToast?.(`Saved ${websiteRow?.sku || code} to dormant queue`, 'success');
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setDormantSaving('');
    }
  };

  const saveBatchToDormant = async () => {
    const ready = batchItems.filter((i) => i.status === 'ready' && i.code);
    if (!ready.length) return;
    if (!batchDefaultCategoryId || !batchDefaultSub1Id) {
      setBatchError('Pick a default category and subcategory for dormant queue.');
      return;
    }
    const labels = categoryLabelsFromIds(taxonomyTree, batchDefaultCategoryId, batchDefaultSub1Id, '');
    setDormantSaving('batch');
    setBatchError('');
    let ok = 0;
    try {
      for (const item of ready) {
        await dormantApi({
          action: 'save',
          code: item.code,
          title: catalogueDisplayTitle(item),
          price: item.price ?? item.sqlRow?.price ?? 0,
          description: catalogueDescription(item),
          category: item.websiteRow?.category || labels.category,
          subcategoryOne: item.websiteRow?.subcategory_one || labels.subcategoryOne,
          subcategoryTwo: item.websiteRow?.subcategory_two || null,
        });
        ok += 1;
      }
      await loadDormant();
      onShowToast?.(`Added ${ok} product${ok === 1 ? '' : 's'} to dormant queue`, 'success');
    } catch (err) {
      setBatchError(err.message);
    } finally {
      setDormantSaving('');
    }
  };

  const removeDormantRow = async (sku) => {
    if (!window.confirm(`Remove ${sku} from dormant queue?`)) return;
    setDormantSaving(`rm-${sku}`);
    try {
      await dormantApi({ action: 'remove', code: sku });
      setDormantRows((prev) => prev.filter((r) => r.sku !== sku));
      onShowToast?.(`Removed ${sku} from dormant queue`, 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
    } finally {
      setDormantSaving('');
    }
  };

  const saveDormantCategories = async (sku) => {
    const edit = dormantEdits[sku];
    if (!edit?.categoryId || !edit?.sub1Id) {
      onShowToast?.('Category and subcategory are required', 'error');
      return;
    }
    const labels = categoryLabelsFromIds(taxonomyTree, edit.categoryId, edit.sub1Id, edit.sub2Id, edit.sub3Id, edit.sub4Id);
    setDormantSaving(`cat-${sku}`);
    try {
      await dormantApi({ action: 'updateCategories', code: sku, ...labels });
      await loadDormant();
      onShowToast?.(`Updated categories for ${sku}`, 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
    } finally {
      setDormantSaving('');
    }
  };



  const resolveLookupCode = (codeOverride) => {
    if (typeof codeOverride === 'string' || typeof codeOverride === 'number') {
      return String(codeOverride).trim();
    }
    return String(code || '').trim();
  };

  const handleLookup = async (codeOverride) => {
    const c = resolveLookupCode(codeOverride);
    if (!c || c === '[object Object]') return;
    if (typeof codeOverride === 'string' || typeof codeOverride === 'number') setCode(c);
    setLookingUp(true);
    setLookupError('');
    setLookupData(null);
    setMatchedBy(null);
    resetLookupDependents();

    try {
      const res = await fetch(`/api/product-loader-lookup?code=${encodeURIComponent(c)}`);
      const json = await readApiJson(res, { fallback: 'Lookup failed' });
      setLookupData(json);
      setMatchedBy(json.matchedBy || null);
      if (json.resolvedCode) setCode(json.resolvedCode);

      // Pre-fill from existing website row
      if (json.websiteRow) {
        const ws = json.websiteRow;
        const resolved = idsFromRowLabels(taxonomyTree, {
          category: ws.category,
          subcategory_one: ws.subcategory_one,
          subcategory_two: ws.subcategory_two,
          subcategory_three: ws.subcategory_three,
          subcategory_four: ws.subcategory_four,
        });
        setCategoryId(resolved.categoryId || '');
        setSub1Id(resolved.sub1Id || '');
        setSub2Id(resolved.sub2Id || '');
        setSub3Id(resolved.sub3Id || '');
        setSub4Id(resolved.sub4Id || '');
        setCategorySource('existing');
        const firstEmpty = SLOT_FIELDS.findIndex((f) => !ws[f]);
        const targetSlot = firstEmpty >= 0 ? firstEmpty + 1 : 1;
        setImageSlot(targetSlot);
        if (json.existingImages.length) {
          setImageUrl(json.existingImages[0]);
          setImageSource('existing');
        }
      }
      if (!json.websiteRow && json.sqlRow) {
        setCategorySource('existing');
        setImageSlot(1);
      }
      if (codeOverride) {
        singleProductRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      setLookupError(err.message || 'Lookup failed');
    } finally {
      setLookingUp(false);
    }
  };

  useEffect(() => {
    const c = String(initialCode || '').trim();
    if (!c) return;
    // A hand-off with a code routes to the Upload tab (the only image workflow
    // now that Single/Folder are merged); the lookup still runs in the background.
    setActiveTab('upload');
    void handleLookup(c).finally(() => onInitialCodeConsumed?.());
  }, [initialCode]);

  const handleFileSelect = async (file) => {
    if (!file?.type.startsWith('image/')) return;
    setFileObj(file);
    const b64 = await fileToBase64(file);
    setFileBase64(b64);
    setImageUrl('');
    setImageSource('');
    setPublishError('');
  };

  const handleUpload = async () => {
    if (!fileObj || !fileBase64) return;
    setUploading(true);
    setPublishError('');
    try {
      const res = await fetch('/api/upload-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fileObj.name,
          contentType: fileObj.type,
          base64: fileBase64,
          sku: code,
          imageSlot,
        }),
      });
      const json = await readApiJson(res, { fallback: 'Upload failed' });
      setImageUrl(json.url);
      setImageSource('upload');
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setUploading(false);
    }
  };


  const handleAnalyze = async () => {
    const hasImage = imageUrl || fileBase64;
    if (!hasImage) return;
    setAnalyzing(true);
    setPublishError('');
    try {
      let b64 = fileBase64;
      let contentType = fileObj?.type || 'image/jpeg';

      if (!b64 && imageUrl) {
        const imgRes = await fetch(imageUrl);
        const blob = await imgRes.blob();
        b64 = await blobToBase64(blob);
        contentType = blob.type || 'image/jpeg';
      }

      const res = await fetch('/api/analyze-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `${code}.jpg`, contentType, base64: b64 }),
      });
      const json = await readApiJson(res, { fallback: 'Analysis failed' });

      const suggestedId = GEMINI_CATEGORY_MAP[json.category] || '';
      if (suggestedId) {
        const node = findNode(taxonomyTree, suggestedId);
        setCategoryId(suggestedId);
        setSub1Id(node?.children?.[0]?.id || '');
        setSub2Id('');
        setSub3Id('');
        setSub4Id('');
        setCategorySource('gemini');
      }
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const { sqlRow, websiteRow, existingImages = [], warnings = [] } = lookupData || {};
  const targetField = SLOT_FIELDS[imageSlot - 1];
  const isOverwritingFilledSlot = Boolean(websiteRow?.[targetField]) && imageSource !== 'existing';

  const canPublish = Boolean(
    lookupData
    && imageUrl
    && categoryId
    && sub1Id
    && (!warnings.includes('price_zero') || priceZeroConfirmed)
    && (!isOverwritingFilledSlot || overwriteConfirmed)
    && !publishing
    && !uploading,
  );

  const handlePublish = async () => {
    if (!canPublish) return;
    const title = catalogueDisplayTitle({ code, title: sqlRow?.title, sqlRow, websiteRow });
    const price = sqlRow?.price ?? websiteRow?.price ?? 0;
    const catNode = findNode(taxonomyTree, categoryId);
    const sub1Node = findNode(taxonomyTree, sub1Id);
    const sub2Node = findNode(taxonomyTree, sub2Id);
    const sub3Node = findNode(taxonomyTree, sub3Id);
    const sub4Node = findNode(taxonomyTree, sub4Id);

    setPublishing(true);
    setPublishError('');
    try {
      const res = await fetch('/api/product-loader-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          displayCode: lookupData?.displayCode,
          title,
          price,
          barcode: websiteRow?.barcode || sqlRow?.barcode || code,
          imageUrl,
          imageSlot,
          imageSource,
          overwriteImage: isOverwritingFilledSlot ? overwriteConfirmed : false,
          category: catNode?.label || categoryId,
          subcategoryOne: sub1Node?.label || sub1Id || catNode?.label || categoryId,
          subcategoryTwo: sub2Node?.label || sub2Id || null,
          subcategoryThree: sub3Node?.label || sub3Id || null,
          subcategoryFour: sub4Node?.label || sub4Id || null,
          description: catalogueDescription({ code, sqlRow, websiteRow }),
          sqlRow: sqlRow || null,
          websiteRow: websiteRow || null,
          stockQty: sqlRow?.onhand ?? websiteRow?.stock_qty,
          availableStock: sqlRow?.available ?? websiteRow?.available_stock,
          categoryConfidence: categorySource === 'gemini' ? 0.85 : 1.0,
          publishMode: 'direct',
        }),
      });
      const json = await readApiJson(res, { fallback: 'Publish failed' });
      setPublishSuccess({ sku: json.sku, action: json.action });
      if (dormantRows.some((r) => r.sku === json.sku)) {
        await dormantApi({ action: 'remove', code: json.sku }).catch(() => {});
        setDormantRows((prev) => prev.filter((r) => r.sku !== json.sku));
      }
      onShowToast?.(
        `${json.action === 'create' ? 'Published' : 'Updated'} ${code} successfully`,
        'success',
      );
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const resetAll = () => {
    setCode('');
    setLookupData(null);
    setLookupError('');
    resetLookupDependents();
  };

  const sub1Options = categoryId ? childrenOf(taxonomyTree, categoryId) : [];
  const sub2Options = sub1Id ? childrenOf(taxonomyTree, sub1Id) : [];
  const sub3Options = sub2Id ? childrenOf(taxonomyTree, sub2Id) : [];
  const sub4Options = sub3Id ? childrenOf(taxonomyTree, sub3Id) : [];
  const batchSub1Options = batchDefaultCategoryId ? childrenOf(taxonomyTree, batchDefaultCategoryId) : [];
  const batchReadyCount = batchItems.filter((i) => i.status === 'ready').length;
  const batchUnmatchedCount = batchItems.filter((i) => i.status === 'unmatched').length;

  const addItemToDormant = async (item) => {
    if (!item?.code) return;
    if (!batchDefaultCategoryId || !batchDefaultSub1Id) {
      onShowToast?.('Pick default category and subcategory first (folder tab or below)', 'warning');
      setActiveTab('image-centre');
      return;
    }
    const labels = categoryLabelsFromIds(taxonomyTree, batchDefaultCategoryId, batchDefaultSub1Id, '');
    try {
      await dormantApi({
        action: 'save',
        code: item.code,
        title: catalogueDisplayTitle(item),
        price: item.price ?? item.sqlRow?.price ?? 0,
        description: catalogueDescription(item),
        category: item.websiteRow?.category || labels.category,
        subcategoryOne: item.websiteRow?.subcategory_one || labels.subcategoryOne,
        subcategoryTwo: item.websiteRow?.subcategory_two || null,
        filename: item.filename,
      });
      await loadDormant();
      onShowToast?.(`Added ${item.code} to dormant queue`, 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
    }
  };

  const addBatchToDormant = async (items) => {
    for (const item of items) {
      await addItemToDormant(item);
    }
  };

  const openAdvanced = (code) => {
    setActiveTab('upload');
    onShowToast?.(`Open Single Image tab and upload an image for ${code}`, 'success');
  };

  const lookupImageIntake = async () => {
    const paths = imageIntakeText.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
    if (!paths.length) {
      setImageIntakeError('Paste at least one Nutstore image path.');
      return;
    }
    setImageIntakeLoading(true);
    setImageIntakeError('');
    try {
      const res = await fetch('/api/nutstore-batch-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, purpose: 'image_processing' }),
      });
      const json = await readApiJson(res, { fallback: 'Nutstore image lookup failed' });
      setImageIntakeItems(json.items || []);
    } catch (err) {
      setImageIntakeError(err.message || 'Nutstore image lookup failed');
    } finally {
      setImageIntakeLoading(false);
    }
  };

  const imageProcessingApi = async (body, fallback) => {
    const res = await fetch('/api/image-processing-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readApiJson(res, { fallback });
  };

  const queueImageIntakeItem = async (item) => {
    if (!item?.canQueue) return;
    setImageJobBusy('queue');
    try {
      const result = await imageProcessingApi({
        action: 'queue',
        sku: item.code,
        targetSlot: item.imageSlot || 1,
        nutstorePath: item.path,
        filename: item.filename,
      }, 'Could not queue this Nutstore image for review');
      setSelectedImageJobId(result.job?.id || '');
      await loadImageJobs();
      onShowToast?.(`${item.code} is saved in the Image Processing Centre review queue.`, 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Could not queue this Nutstore image for review.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const processSelectedImageJob = async () => {
    const job = imageJobs.find((item) => item.id === selectedImageJobId);
    if (!job) return;
    setImageJobBusy('process');
    try {
      await imageProcessingApi({ action: 'process', jobId: job.id }, 'Image processing failed');
      await loadImageJobs();
      onShowToast?.('Candidate created and held for review. No live image was changed.', 'success');
    } catch (err) {
      await loadImageJobs();
      onShowToast?.(err.message || 'Image processing failed.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const uploadManualCandidate = async (file) => {
    const job = imageJobs.find((item) => item.id === selectedImageJobId);
    if (!job || !file) return;
    setImageJobBusy('candidate');
    try {
      const candidateBase64 = await fileToBase64(file);
      await imageProcessingApi({
        action: 'upload_candidate',
        jobId: job.id,
        candidateBase64,
        candidateContentType: file.type || 'image/jpeg',
      }, 'Could not save the manual candidate');
      await loadImageJobs();
      onShowToast?.('Manual candidate is ready for before-and-after review.', 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Could not save the manual candidate.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const approveSelectedImageJob = async ({ reviewChecklist, reviewNotes } = {}) => {
    const job = imageJobs.find((item) => item.id === selectedImageJobId);
    if (!job) return;
    setImageJobBusy('approve');
    try {
      await imageProcessingApi({ action: 'approve', jobId: job.id, reviewChecklist, reviewNotes }, 'Could not approve this review candidate');
      await loadImageJobs();
      onShowToast?.('Review recorded. The staged image still has not changed the live catalogue.', 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Could not approve this review candidate.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const applySelectedImageJob = async (confirmSku) => {
    const job = imageJobs.find((item) => item.id === selectedImageJobId);
    if (!job) return;
    setImageJobBusy('apply');
    try {
      await imageProcessingApi({ action: 'apply', jobId: job.id, confirmSku }, 'Could not apply this approved image');
      await loadImageJobs();
      onShowToast?.(`Approved image applied to ${job.sku} slot ${job.targetSlot}.`, 'success');
    } catch (err) {
      await loadImageJobs();
      onShowToast?.(err.message || 'Could not apply this approved image.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const discardSelectedImageJob = async () => {
    const job = imageJobs.find((item) => item.id === selectedImageJobId);
    if (!job) return;
    setImageJobBusy('discard');
    try {
      await imageProcessingApi({ action: 'discard', jobId: job.id }, 'Could not discard this review job');
      await loadImageJobs();
      onShowToast?.('Review job discarded. Its staged files will not be applied.', 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Could not discard this review job.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  const sendUploadedImageToCentre = async (item) => {
    const exactSku = item?.websiteRow
      && String(item.websiteRow.sku || '').trim().toUpperCase() === String(item.code || '').trim().toUpperCase();
    if (!item?.file || !exactSku) {
      onShowToast?.('This upload needs an exact existing website SKU before it can enter Image Processing Centre.', 'warning');
      return;
    }
    setImageJobBusy('queue');
    try {
      const sourceBase64 = await fileToBase64(item.file);
      const result = await imageProcessingApi({
        action: 'queue',
        sku: item.code,
        targetSlot: item.imageSlot || 1,
        sourceBase64,
        sourceContentType: item.file.type || 'image/jpeg',
        filename: item.filename,
      }, 'Could not save this upload in Image Processing Centre');
      setSelectedImageJobId(result.job?.id || '');
      setActiveTab('image-centre');
      await loadImageJobs();
      onShowToast?.(`${item.filename} is saved in Image Processing Centre for manual review.`, 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Could not prepare the uploaded image for review.', 'error');
    } finally {
      setImageJobBusy('');
    }
  };

  return (
    <div className="adm-panel" style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div className="adm-section-head" style={{ marginBottom: 24 }}>
        <div>
          <h2 className="adm-section-title">Product Loader</h2>
          <p className="adm-section-note">Browse Nutstore or upload images — Positill fills price, description and stock.</p>
          {nutstoreStatus && (
            <p style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: nutstoreStatus.connected ? '#15803d' : nutstoreStatus.configured === false ? '#6b7280' : '#c2410c' }}>
              {nutstoreStatus.connected
                ? `● Connected to ${nutstoreStatus.libraryLabel || 'PTR Photos'}`
                : nutstoreStatus.configured === false
                  ? '● Nutstore (PTR Photos) is not configured'
                  : `● ${nutstoreStatus.libraryLabel || 'PTR Photos'} not reachable — check Nutstore WebDAV credentials`}
            </p>
          )}
          {sqlLiveStatus?.bridgeConfigured && (
            <p style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: sqlLiveStatus.sqlConnectionTest ? '#15803d' : '#c2410c' }}>
              {sqlLiveStatus.sqlConnectionTest
                ? '● Live Positill SQL connected'
                : '● Live SQL configured but bridge unreachable — check Cloudflare tunnel on BLADERUNNER'}
            </p>
          )}
        </div>
      </div>

      <nav className="pl-tabs" aria-label="Product Loader sections">
        {LOADER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`pl-tab${activeTab === tab.id ? ' pl-tab--on' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'nutstore' && (
        <ProductLoaderNutstore
          taxonomyTree={taxonomyTree}
          batchDefaultCategoryId={batchDefaultCategoryId}
          setBatchDefaultCategoryId={(id) => setBatchDefaultPathIds(id ? [id] : [])}
          batchDefaultSub1Id={batchDefaultSub1Id}
          setBatchDefaultSub1Id={(id) => setBatchDefaultPathIds([batchDefaultCategoryId, id].filter(Boolean))}
          batchOverwrite={batchOverwrite}
          setBatchOverwrite={setBatchOverwrite}
          onShowToast={onShowToast}
          onPublished={(result) => setPublishSuccess(result)}
        />
      )}

      {activeTab === 'upload' && (
        <ProductLoaderUpload
          taxonomyTree={taxonomyTree}
          batchDefaultPathIds={batchDefaultPathIds}
          setBatchDefaultPathIds={setBatchDefaultPathIds}
          batchOverwrite={batchOverwrite}
          setBatchOverwrite={setBatchOverwrite}
          onShowToast={onShowToast}
          onSendToImageCentre={sendUploadedImageToCentre}
          imageCentreQueueCount={imageJobs.filter((job) => !['applied', 'discarded', 'expired'].includes(job.status)).length}
        />
      )}

      {activeTab === 'image-centre' && (
        <ProductLoaderDormantQueue
          taxonomyTree={taxonomyTree}
          rows={dormantRows}
          edits={dormantEdits}
          setEdits={setDormantEdits}
          loading={dormantLoading}
          saving={dormantSaving}
          error={dormantLoadError}
          loaded={dormantRequested}
          onRefresh={() => { void loadDormant(); void loadImageJobs(); }}
          onRetry={() => { void loadDormant(); void loadImageJobs(); }}
          onSaveCategories={saveDormantCategories}
          onRemove={removeDormantRow}
          onOpen={openAdvanced}
          imageIntakeText={imageIntakeText}
          setImageIntakeText={setImageIntakeText}
          imageIntakeItems={imageIntakeItems}
          imageIntakeLoading={imageIntakeLoading}
          imageIntakeError={imageIntakeError}
          onLookupImageIntake={() => void lookupImageIntake()}
          onQueueImageIntake={queueImageIntakeItem}
          imageJobs={imageJobs}
          imageJobsLoading={imageJobsLoading}
          imageJobsError={imageJobsError}
          imageProcessingHealth={imageProcessingHealth}
          selectedImageJobId={selectedImageJobId}
          onSelectImageJob={setSelectedImageJobId}
          imageJobBusy={imageJobBusy}
          onProcessImageJob={() => void processSelectedImageJob()}
          onUploadManualCandidate={uploadManualCandidate}
          onApproveImageJob={approveSelectedImageJob}
          onApplyImageJob={applySelectedImageJob}
          onDiscardImageJob={() => void discardSelectedImageJob()}
        />
      )}


      {publishSuccess && (
        <ProductLoaderPublishSuccess
          result={publishSuccess}
          mainSiteUrl={mainSiteUrl}
          onUploadNext={() => { setPublishSuccess(null); setActiveTab("upload"); }}
          onDone={() => setPublishSuccess(null)}
        />
      )}
    </div>
  );
}
