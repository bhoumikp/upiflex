(() => {
  "use strict";

  const STORAGE_KEY = "upi-saved-list-v1";

  const elements = {
    reader: document.getElementById("reader"),
    statusMessage: document.getElementById("statusMessage"),
    resultBox: document.getElementById("resultBox"),
    upiIdValue: document.getElementById("upiIdValue"),
    startScanBtn: document.getElementById("startScanBtn"),
    copyBtn: document.getElementById("copyBtn"),
    scanAgainBtn: document.getElementById("scanAgainBtn"),
    saveUpiBtn: document.getElementById("saveUpiBtn"),
    clearBtn: document.getElementById("clearBtn"),
    qrImageInput: document.getElementById("qrImageInput"),
    savedUpisSection: document.getElementById("savedUpisSection"),
    savedUpisList: document.getElementById("savedUpisList"),
    savedUpisEmpty: document.getElementById("savedUpisEmpty"),
    clearSavedUpisBtn: document.getElementById("clearSavedUpisBtn")
  };

  const supportsHtml5Qrcode = typeof window.Html5Qrcode !== "undefined";
  const supportsBarcodeDetector = typeof window.BarcodeDetector !== "undefined";

  let html5Scanner = null;
  let cameraStream = null;
  let scanRafId = null;
  let isScanning = false;
  let isStarting = false;
  let detectInProgress = false;
  let extractedUpiId = "";
  let lastDetectTime = 0;
  let qrDetector = null;
  let savedUpis = [];

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.setAttribute("autoplay", "true");
  video.setAttribute("muted", "true");
  video.className = "camera-video";

  const setStatus = (message, type = "neutral") => {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.remove("status-neutral", "status-success", "status-error");
    elements.statusMessage.classList.add(`status-${type}`);
  };

  const safeStorageRead = () => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  };

  const safeStorageWrite = (value) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
      return true;
    } catch {
      return false;
    }
  };

  const safeStorageRemove = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  };

  const normalizeUpiId = (value) => {
    if (!value || typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const normalizeLabel = (value) => {
    if (!value || typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const loadSavedUpis = () => {
    const rawValue = safeStorageRead();
    if (!rawValue) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const deduped = [];
      const seen = new Set();

      for (const item of parsed) {
        const upiId = normalizeUpiId(
          typeof item === "string" ? item : item && item.upiId
        );
        const label = normalizeLabel(typeof item === "object" && item ? item.label : null);

        if (!upiId || seen.has(upiId.toLowerCase())) {
          continue;
        }

        seen.add(upiId.toLowerCase());
        deduped.push({
          upiId,
          label: label || "Unnamed UPI",
          savedAt: typeof item === "object" && item && typeof item.savedAt === "string"
            ? item.savedAt
            : new Date().toISOString()
        });
      }

      return deduped;
    } catch {
      return [];
    }
  };

  const persistSavedUpis = () => {
    const serialized = JSON.stringify(savedUpis);
    return safeStorageWrite(serialized);
  };

  const formatSavedAt = (savedAt) => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(savedAt));
    } catch {
      return "";
    }
  };

  const promptForIdentity = (existingLabel = "") => {
    const message = existingLabel
      ? "Enter a name for this UPI ID"
      : "Enter a name for this UPI ID so you can remember who it belongs to";
    const value = window.prompt(message, existingLabel);
    return normalizeLabel(value);
  };

  const copyText = async (text) => {
    if (!text) {
      return false;
    }

    if (!navigator.clipboard || !window.isSecureContext) {
      setStatus("Copy requires HTTPS secure context", "error");
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      setStatus("Unable to copy UPI ID", "error");
      return false;
    }
  };

  const resetResultBox = () => {
    elements.resultBox.classList.add("d-none");
    elements.resultBox.classList.remove("alert-danger", "alert-success");
    elements.resultBox.innerHTML = '<div><strong>UPI ID:</strong> <span id="upiIdValue"></span></div>';
    elements.upiIdValue = document.getElementById("upiIdValue");
  };

  const updateSavedUpiSectionState = () => {
    const hasSavedUpis = savedUpis.length > 0;
    elements.savedUpisEmpty.classList.toggle("d-none", hasSavedUpis);
    elements.savedUpisList.classList.toggle("d-none", !hasSavedUpis);
    elements.clearSavedUpisBtn.classList.toggle("d-none", !hasSavedUpis);
  };

  const renderSavedUpis = () => {
    elements.savedUpisList.innerHTML = "";

    if (!savedUpis.length) {
      updateSavedUpiSectionState();
      return;
    }

    const fragment = document.createDocumentFragment();

    savedUpis.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "saved-upi-item border rounded-3 p-3";
      item.dataset.upiId = entry.upiId;

      const content = document.createElement("div");
      content.className = "saved-upi-item__content";

      const upiValue = document.createElement("div");
      upiValue.className = "saved-upi-item__upi";
      upiValue.textContent = entry.upiId;

      const label = document.createElement("div");
      label.className = "saved-upi-item__label";
      label.textContent = entry.label || "Unnamed UPI";

      const meta = document.createElement("div");
      meta.className = "saved-upi-item__meta text-muted small";
      meta.textContent = entry.savedAt ? `Saved ${formatSavedAt(entry.savedAt)}` : "Saved UPI ID";

      content.appendChild(label);
      content.appendChild(upiValue);
      content.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "saved-upi-item__actions";

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "btn btn-sm btn-outline-success";
      copyButton.dataset.action = "copy";
      copyButton.textContent = "Copy";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn btn-sm btn-outline-danger";
      deleteButton.dataset.action = "delete";
      deleteButton.textContent = "Delete";

      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "btn btn-sm btn-outline-primary";
      renameButton.dataset.action = "rename";
      renameButton.textContent = "Rename";

      actions.appendChild(copyButton);
      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);

      item.appendChild(content);
      item.appendChild(actions);
      fragment.appendChild(item);
    });

    elements.savedUpisList.appendChild(fragment);
    updateSavedUpiSectionState();
  };

  const upsertSavedUpi = (upiId) => {
    const normalizedUpiId = normalizeUpiId(upiId);
    if (!normalizedUpiId) {
      return { saved: false, duplicated: false };
    }

    const previousSavedUpis = savedUpis.slice();
    const now = new Date().toISOString();
    const existingIndex = savedUpis.findIndex(
      (entry) => entry.upiId.toLowerCase() === normalizedUpiId.toLowerCase()
    );
    const duplicated = existingIndex !== -1;
    const existingLabel = duplicated ? savedUpis[existingIndex].label || "" : "";
    const label = promptForIdentity(existingLabel);

    if (!label) {
      setStatus("A name is required before saving", "error");
      return { saved: false, duplicated, canceled: true };
    }

    if (duplicated) {
      savedUpis.splice(existingIndex, 1);
    }

    savedUpis.unshift({
      upiId: normalizedUpiId,
      label,
      savedAt: now
    });

    if (!persistSavedUpis()) {
      savedUpis = previousSavedUpis;
      renderSavedUpis();
      return { saved: false, duplicated };
    }

    renderSavedUpis();

    return { saved: true, duplicated };
  };

  const removeSavedUpi = (upiId) => {
    const normalizedUpiId = normalizeUpiId(upiId);
    if (!normalizedUpiId) {
      return false;
    }

    const previousSavedUpis = savedUpis.slice();
    const nextSavedUpis = savedUpis.filter(
      (entry) => entry.upiId.toLowerCase() !== normalizedUpiId.toLowerCase()
    );

    if (nextSavedUpis.length === savedUpis.length) {
      return false;
    }

    savedUpis = nextSavedUpis;
    if (!persistSavedUpis()) {
      savedUpis = previousSavedUpis;
      renderSavedUpis();
      return false;
    }

    renderSavedUpis();
    return true;
  };

  const renameSavedUpi = (upiId) => {
    const normalizedUpiId = normalizeUpiId(upiId);
    if (!normalizedUpiId) {
      return false;
    }

    const entry = savedUpis.find(
      (item) => item.upiId.toLowerCase() === normalizedUpiId.toLowerCase()
    );
    if (!entry) {
      return false;
    }

    const nextLabel = promptForIdentity(entry.label || "");
    if (!nextLabel) {
      setStatus("A name is required", "error");
      return false;
    }

    const previousLabel = entry.label;
    entry.label = nextLabel;

    if (!persistSavedUpis()) {
      entry.label = previousLabel;
      renderSavedUpis();
      return false;
    }

    renderSavedUpis();
    return true;
  };

  const clearSavedUpis = () => {
    const previousSavedUpis = savedUpis.slice();
    savedUpis = [];
    if (!safeStorageRemove()) {
      savedUpis = previousSavedUpis;
      renderSavedUpis();
      return false;
    }

    renderSavedUpis();
    return true;
  };

  const showResult = (upiId) => {
    extractedUpiId = upiId;
    elements.upiIdValue.textContent = upiId;
    elements.resultBox.classList.remove("d-none", "alert-danger");
    elements.resultBox.classList.add("alert-success");
    elements.copyBtn.classList.remove("d-none");
    elements.scanAgainBtn.classList.remove("d-none");
    elements.saveUpiBtn.classList.remove("d-none");
    setStatus("UPI QR detected", "success");
  };

  const showInvalid = () => {
    extractedUpiId = "";
    elements.resultBox.classList.remove("d-none", "alert-success");
    elements.resultBox.classList.add("alert-danger");
    elements.resultBox.textContent = "Invalid UPI QR Code";
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.remove("d-none");
    elements.saveUpiBtn.classList.add("d-none");
    setStatus("Invalid UPI QR Code", "error");
  };

  const parseUpiId = (rawText) => {
    if (!rawText || typeof rawText !== "string") {
      return null;
    }

    const trimmed = rawText.trim();
    if (!trimmed.toLowerCase().startsWith("upi://")) {
      return null;
    }

    try {
      const parsedUrl = new URL(trimmed);
      const pa = parsedUrl.searchParams.get("pa");
      return pa && pa.trim() ? pa.trim() : null;
    } catch {
      return null;
    }
  };

  const handleDecodedText = async (decodedText) => {
    await stopScanner();

    const upiId = parseUpiId(decodedText);
    if (upiId) {
      resetResultBox();
      showResult(upiId);
      return;
    }

    showInvalid();
  };

  const ensureHtml5Scanner = () => {
    if (!html5Scanner) {
      html5Scanner = new Html5Qrcode("reader", { verbose: false });
    }
    return html5Scanner;
  };

  const stopNativeScanner = async () => {
    detectInProgress = false;

    if (scanRafId) {
      cancelAnimationFrame(scanRafId);
      scanRafId = null;
    }

    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }

    video.pause();
    video.srcObject = null;
  };

  const stopHtml5Scanner = async () => {
    if (!html5Scanner) {
      return;
    }

    try {
      const state = html5Scanner.getState && html5Scanner.getState();
      if (state === 2 || state === 3) {
        await html5Scanner.stop();
      }
      await html5Scanner.clear();
    } catch {
      // ignore
    }
  };

  const stopScanner = async () => {
    isScanning = false;
    await Promise.all([stopHtml5Scanner(), stopNativeScanner()]);
  };

  const scanFrame = async (timestamp) => {
    if (!isScanning) {
      return;
    }

    scanRafId = requestAnimationFrame((nextTs) => {
      scanFrame(nextTs).catch(() => {
        setStatus("Unable to process camera frame", "error");
      });
    });

    if (
      detectInProgress ||
      timestamp - lastDetectTime < 180 ||
      video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
    ) {
      return;
    }

    lastDetectTime = timestamp;
    detectInProgress = true;

    try {
      if (!qrDetector && supportsBarcodeDetector) {
        qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
      }

      if (!qrDetector) {
        throw new Error("BarcodeDetector not supported");
      }

      const codes = await qrDetector.detect(video);
      if (codes && codes.length > 0 && codes[0].rawValue) {
        await handleDecodedText(codes[0].rawValue);
      }
    } finally {
      detectInProgress = false;
    }
  };

  const startHtml5CameraScan = async () => {
    const scanner = ensureHtml5Scanner();

    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: (vw, vh) => {
          const minEdge = Math.min(vw, vh);
          const size = Math.floor(minEdge * 0.8);
          return { width: size, height: size };
        },
        aspectRatio: 1
      },
      (decodedText) => {
        handleDecodedText(decodedText).catch(() => {
          setStatus("Unable to process QR result", "error");
        });
      },
      () => {
        // ignore frame decode errors for smooth UX
      }
    );

    isScanning = true;
    setStatus("Scanning in progress...", "neutral");
  };

  const startNativeCameraScan = async () => {
    if (!qrDetector && supportsBarcodeDetector) {
      qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
    }

    elements.reader.innerHTML = "";
    elements.reader.appendChild(video);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = cameraStream;
    await video.play();

    isScanning = true;
    setStatus("Scanning in progress...", "neutral");
    scanRafId = requestAnimationFrame((ts) => {
      scanFrame(ts).catch(() => {
        setStatus("Unable to start frame scan", "error");
      });
    });
  };

  const startScanner = async () => {
    if (isStarting) return;

    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");
    elements.saveUpiBtn.classList.add("d-none");

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera API is unavailable on this browser.", "error");
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Camera needs HTTPS or localhost.", "error");
      return;
    }

    isStarting = true;
    await stopScanner();

    // Ensure reader is empty before starting any scanner
    elements.reader.innerHTML = "";

    setStatus("Requesting camera permission...", "neutral");

    try {
      if (supportsHtml5Qrcode) {
        await startHtml5CameraScan();
      } else if (supportsBarcodeDetector) {
        await startNativeCameraScan();
      } else {
        setStatus("QR scanning not supported on this browser.", "error");
      }
    } catch (error) {
      console.error("Scanner start error:", error);
      const message = (error && error.message) || "Camera access failed";
      if (/permission|denied|notallowed/i.test(message)) {
        setStatus("Camera permission denied. Use Upload QR Image.", "error");
      } else {
        setStatus(`Error: ${message.slice(0, 40)}${message.length > 40 ? "..." : ""}`, "error");
      }
      await stopScanner();
    } finally {
      isStarting = false;
    }
  };

  const loadImageFromFile = (file) => new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Invalid image"));
    };

    image.src = objectUrl;
  });

  const scanFromImage = async (file) => {
    if (!file) {
      return;
    }

    await stopScanner();
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");
    elements.saveUpiBtn.classList.add("d-none");
    setStatus("Reading QR image...", "neutral");

    try {
      let decodedText = "";

      if (supportsHtml5Qrcode) {
        const scanner = ensureHtml5Scanner();
        decodedText = await scanner.scanFile(file, true);
      } else if (supportsBarcodeDetector) {
        if (!qrDetector) {
          qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
        }

        let codes = [];
        if (window.createImageBitmap) {
          const bitmap = await createImageBitmap(file);
          codes = await qrDetector.detect(bitmap);
          bitmap.close();
        } else {
          const image = await loadImageFromFile(file);
          codes = await qrDetector.detect(image);
        }

        if (!codes || !codes.length || !codes[0].rawValue) {
          showInvalid();
          return;
        }

        decodedText = codes[0].rawValue;
      } else {
        setStatus("Image QR scanning not supported on this browser.", "error");
        return;
      }

      const upiId = parseUpiId(decodedText);
      if (upiId) {
        showResult(upiId);
      } else {
        showInvalid();
      }
    } catch {
      showInvalid();
    }
  };

  const copyUpiId = async () => {
    if (!extractedUpiId) {
      return;
    }

    const copied = await copyText(extractedUpiId);
    if (copied) {
      setStatus("UPI ID copied", "success");
    }
  };

  const saveUpiId = async () => {
    if (!extractedUpiId) {
      setStatus("No valid UPI ID to save", "error");
      return;
    }

    const result = upsertSavedUpi(extractedUpiId);
    if (!result.saved) {
      if (!result.canceled) {
        setStatus("Unable to save UPI ID", "error");
      }
      return;
    }

    setStatus(
      result.duplicated ? "UPI ID updated with name" : "UPI ID saved with name",
      "success"
    );
  };

  const clearAll = async () => {
    await stopScanner();
    extractedUpiId = "";
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");
    elements.saveUpiBtn.classList.add("d-none");
    elements.qrImageInput.value = "";
    setStatus("Ready to scan", "neutral");
  };

  const registerServiceWorker = async () => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    try {
      await navigator.serviceWorker.register("service-worker.js");
    } catch {
      // Keep app functional without SW.
    }
  };

  const bindSavedUpiEvents = () => {
    elements.savedUpisList.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("button[data-action]");
      if (!actionButton) {
        return;
      }

      const item = actionButton.closest("[data-upi-id]");
      const upiId = item && item.dataset ? item.dataset.upiId : "";
      if (!upiId) {
        return;
      }

      const action = actionButton.dataset.action;
      if (action === "copy") {
        const copied = await copyText(upiId);
        if (copied) {
          setStatus("Saved UPI ID copied", "success");
        }
        return;
      }

      if (action === "delete") {
        removeSavedUpi(upiId);
        return;
      }

      if (action === "rename") {
        renameSavedUpi(upiId);
      }
    });

    elements.clearSavedUpisBtn.addEventListener("click", () => {
      if (!savedUpis.length) {
        return;
      }

      const shouldClear = window.confirm("Clear all saved UPI IDs?");
      if (shouldClear) {
        clearSavedUpis();
        setStatus("Saved UPI IDs cleared", "success");
      }
    });
  };

  const init = () => {
    savedUpis = loadSavedUpis();
    renderSavedUpis();

    elements.startScanBtn.addEventListener("click", () => {
      startScanner();
    });

    elements.scanAgainBtn.addEventListener("click", () => {
      startScanner();
    });

    elements.clearBtn.addEventListener("click", () => {
      clearAll();
    });

    elements.copyBtn.addEventListener("click", () => {
      copyUpiId();
    });

    elements.saveUpiBtn.addEventListener("click", () => {
      saveUpiId();
    });

    elements.qrImageInput.addEventListener("change", (event) => {
      const [file] = event.target.files || [];
      scanFromImage(file);
    });

    bindSavedUpiEvents();

    window.addEventListener("pagehide", () => {
      stopScanner();
    });

    registerServiceWorker();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
