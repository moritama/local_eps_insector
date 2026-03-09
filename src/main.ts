import './style.css'
// @ts-ignore
import UTIF from 'utif'

// === UI Elements ===
const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

const infoPanel = document.getElementById('info-panel') as HTMLDivElement;
const metadataList = document.getElementById('metadata-list') as HTMLUListElement;

const previewArea = document.getElementById('preview-area') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const fallbackUi = document.getElementById('fallback-ui') as HTMLDivElement;
const previewSuccess = document.getElementById('preview-success') as HTMLDivElement;


// === Events ===
const setupDragAndDrop = () => {
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFile(target.files[0]);
    }
  });
};

const resetUI = () => {
  infoPanel.classList.add('hidden');
  previewArea.classList.add('hidden');
  fallbackUi.classList.add('hidden');
  previewSuccess.classList.add('hidden');
  metadataList.innerHTML = '';
};

const handleFile = async (file: File) => {
  console.log('Selected file:', file.name);
  resetUI();
  
  // 第1段階: メタデータ抽出
  await extractMetadata(file);

  // 第2段階: 内包プレビュー抽出
  await extractPreview(file);
};

// === 第1段階: メタデータ抽出 ===
const extractMetadata = async (file: File) => {
  // 最初の数KBだけを読み込んでメタデータを取得する
  const CHUNK_SIZE = 8192; // 8KB
  const slice = file.slice(0, CHUNK_SIZE);
  const text = await slice.text(); // UTF-8として読み込む

  // 抽出するプロパティ
  let title = file.name;
  let creator = 'Unknown';
  let boundingBox = '';
  let hiResBoundingBox = '';

  // メタデータを正規表現で抽出
  const titleMatch = text.match(/%%Title:\s*(.*)/);
  if (titleMatch) title = titleMatch[1].trim();

  const creatorMatch = text.match(/%%Creator:\s*(.*)/);
  if (creatorMatch) creator = creatorMatch[1].trim();

  const hiResMatch = text.match(/%%HiResBoundingBox:\s*([\d.\s-]+)/);
  if (hiResMatch) {
    hiResBoundingBox = hiResMatch[1].trim();
  }

  const bbMatch = text.match(/%%BoundingBox:\s*([\d.\s-]+)/);
  if (bbMatch) {
    boundingBox = bbMatch[1].trim();
  }

  // サイズの計算 (ポイントからmmへの変換など)
  let sizeInfo = 'Unknown Size';
  const targetBox = hiResBoundingBox || boundingBox;
  if (targetBox) {
    const parts = targetBox.split(/\s+/).map(Number);
    if (parts.length === 4) {
      const [x1, y1, x2, y2] = parts;
      const widthPt = Math.abs(x2 - x1);
      const heightPt = Math.abs(y2 - y1);
      
      // 1 pt = 25.4 / 72 mm
      const ptToMm = 25.4 / 72;
      const widthMm = (widthPt * ptToMm).toFixed(1);
      const heightMm = (heightPt * ptToMm).toFixed(1);

      sizeInfo = `幅: ${widthMm} mm / 高さ: ${heightMm} mm`;
    }
  }

  // ファイルサイズ
  const fileSizeMb = (file.size / (1024 * 1024)).toFixed(2);

  // UIに反映
  addMetadataItem('File Name', title);
  addMetadataItem('Creator', creator);
  addMetadataItem('Size', sizeInfo);
  addMetadataItem('File Size', `${fileSizeMb} MB`);

  infoPanel.classList.remove('hidden');
};

const addMetadataItem = (label: string, value: string) => {
  const li = document.createElement('li');
  // textContentを使ってエスケープする
  const strLabel = document.createElement('strong');
  strLabel.textContent = label;
  
  const spanValue = document.createElement('span');
  spanValue.textContent = value;

  li.appendChild(strLabel);
  li.appendChild(spanValue);
  metadataList.appendChild(li);
};

// === 第2段階: 内包プレビュー抽出 ===
const extractPreview = async (file: File) => {
  const headerSlice = file.slice(0, 30);
  const headerBuf = await headerSlice.arrayBuffer();
  
  if (headerBuf.byteLength >= 30) {
    const dataView = new DataView(headerBuf);
    const isDosEps = dataView.getUint8(0) === 0xC5 && 
                     dataView.getUint8(1) === 0xD0 && 
                     dataView.getUint8(2) === 0xD3 && 
                     dataView.getUint8(3) === 0xC6;
    
    if (isDosEps) {
      // TIFFオフセットは20番目から4バイト (リトルエンディアン)
      const tiffOffset = dataView.getUint32(20, true);
      const tiffLength = dataView.getUint32(24, true);

      if (tiffOffset > 0 && tiffLength > 0) {
        const tiffSlice = file.slice(tiffOffset, tiffOffset + tiffLength);
        const tiffBuf = await tiffSlice.arrayBuffer();
        
        try {
          const ifds = UTIF.decode(tiffBuf);
          if (ifds && ifds.length > 0) {
            UTIF.decodeImage(tiffBuf, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const width = ifds[0].width;
            const height = ifds[0].height;

            previewCanvas.width = width;
            previewCanvas.height = height;
            const ctx = previewCanvas.getContext('2d');
            if (ctx) {
              const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
              ctx.putImageData(imageData, 0, 0);
              
              previewArea.classList.remove('hidden');
              previewSuccess.classList.remove('hidden');
              return; // 成功
            }
          }
        } catch (e) {
          console.error("TIFF decode error", e);
        }
      }
    }
  }

  // 失敗した場合や、DOS EPS形式でない場合
  previewArea.classList.remove('hidden');
  fallbackUi.classList.remove('hidden');
};

// === 初期化 ===
const init = () => {
  setupDragAndDrop();
};

init();
