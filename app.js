(() => {
  "use strict";

  const elements = {
    reader: document.getElementById("reader"),
    statusMessage: document.getElementById("statusMessage"),
    resultBox: document.getElementById("resultBox"),
    upiIdValue: document.getElementById("upiIdValue"),
    startScanBtn: document.getElementById("startScanBtn"),
    copyBtn: document.getElementById("copyBtn"),
    scanAgainBtn: document.getElementById("scanAgainBtn"),
    clearBtn: document.getElementById("clearBtn"),
    qrImageInput: document.getElementById("qrImageInput")
  };

  const supportsBarcodeDetector = typeof window.BarcodeDetector !== "undefined";
  const qrDetector = supportsBarcodeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;

  let cameraStream = null;
  let scanRafId = null;
  let isScanning = false;
  let detectInProgress = false;
  let extractedUpiId = "";
  let lastDetectTime = 0;

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.setAttribute("autoplay", "true");
  video.setAttribute("muted", "true");
  video.className = "camera-video";
  elements.reader.appendChild(video);

  const setStatus = (message, type = "neutral") => {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.remove("status-neutral", "status-success", "status-error");
    elements.statusMessage.classList.add(`status-${type}`);
  };

  const resetResultBox = () => {
    elements.resultBox.classList.add("d-none");
    elements.resultBox.classList.remove("alert-danger", "alert-success");
    elements.resultBox.innerHTML = '<div><strong>UPI ID:</strong> <span id="upiIdValue"></span></div>';
    elements.upiIdValue = document.getElementById("upiIdValue");
  };

  const showResult = (upiId) => {
    extractedUpiId = upiId;
    elements.upiIdValue.textContent = upiId;
    elements.resultBox.classList.remove("d-none", "alert-danger");
    elements.resultBox.classList.add("alert-success");
    elements.copyBtn.classList.remove("d-none");
    elements.scanAgainBtn.classList.remove("d-none");
    setStatus("UPI QR detected", "success");
  };

  const showInvalid = () => {
    extractedUpiId = "";
    elements.resultBox.classList.remove("d-none", "alert-success");
    elements.resultBox.classList.add("alert-danger");
    elements.resultBox.textContent = "Invalid UPI QR Code";
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.remove("d-none");
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

  const stopScanner = async () => {
    isScanning = false;
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

  const scanFrame = async (timestamp) => {
    if (!isScanning) {
      return;
    }

    scanRafId = requestAnimationFrame((nextTs) => {
      scanFrame(nextTs).catch(() => {
        setStatus("Unable to process camera frame", "error");
      });
    });

    if (detectInProgress || timestamp - lastDetectTime < 180 || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      return;
    }

    lastDetectTime = timestamp;
    detectInProgress = true;

    try {
      const codes = await qrDetector.detect(video);
      if (codes && codes.length > 0 && codes[0].rawValue) {
        await handleDecodedText(codes[0].rawValue);
      }
    } finally {
      detectInProgress = false;
    }
  };

  const startScanner = async () => {
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");

    if (!supportsBarcodeDetector) {
      setStatus("QR scanning is not supported on this browser offline.", "error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera API is unavailable on this browser.", "error");
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Camera needs HTTPS or localhost.", "error");
      return;
    }

    await stopScanner();
    setStatus("Requesting camera permission...", "neutral");

    try {
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
    } catch (error) {
      const message = (error && error.message) || "Camera access failed";
      if (/permission|denied|notallowed/i.test(message)) {
        setStatus("Camera permission denied. Use Upload QR Image.", "error");
      } else {
        setStatus("Unable to start camera scanner", "error");
      }
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

    if (!supportsBarcodeDetector) {
      setStatus("Image QR scanning is not supported on this browser offline.", "error");
      return;
    }

    setStatus("Reading QR image...", "neutral");

    try {
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

      const upiId = parseUpiId(codes[0].rawValue);
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

    if (!navigator.clipboard || !window.isSecureContext) {
      setStatus("Copy requires HTTPS secure context", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(extractedUpiId);
      setStatus("UPI ID copied", "success");
    } catch {
      setStatus("Unable to copy UPI ID", "error");
    }
  };

  const clearAll = async () => {
    await stopScanner();
    extractedUpiId = "";
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");
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

  const init = () => {
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

    elements.qrImageInput.addEventListener("change", (event) => {
      const [file] = event.target.files || [];
      scanFromImage(file);
    });

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
