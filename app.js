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

  let scanner = null;
  let isScanning = false;
  let extractedUpiId = "";

  const setStatus = (message, type = "neutral") => {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.remove("status-neutral", "status-success", "status-error");
    elements.statusMessage.classList.add(`status-${type}`);
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
    elements.upiIdValue.textContent = "";
    elements.resultBox.classList.remove("d-none", "alert-success");
    elements.resultBox.classList.add("alert-danger");
    elements.resultBox.innerHTML = "Invalid UPI QR Code";
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.remove("d-none");
    setStatus("Invalid UPI QR Code", "error");
  };

  const resetResultBox = () => {
    elements.resultBox.classList.add("d-none");
    elements.resultBox.classList.remove("alert-danger", "alert-success");
    elements.resultBox.innerHTML = '<div><strong>UPI ID:</strong> <span id="upiIdValue"></span></div>';
    elements.upiIdValue = document.getElementById("upiIdValue");
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

  const handleScanText = async (decodedText) => {
    const upiId = parseUpiId(decodedText);

    if (isScanning) {
      await stopScanner();
    }

    if (upiId) {
      resetResultBox();
      showResult(upiId);
      return;
    }

    showInvalid();
  };

  const ensureScanner = () => {
    if (!scanner) {
      scanner = new Html5Qrcode("reader", { verbose: false });
    }
    return scanner;
  };

  const startScanner = async () => {
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    elements.scanAgainBtn.classList.add("d-none");
    setStatus("Requesting camera permission...", "neutral");

    try {
      const qrScanner = ensureScanner();
      await qrScanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(minEdge * 0.8);
            return { width: size, height: size };
          },
          aspectRatio: 1
        },
        (decodedText) => {
          handleScanText(decodedText).catch(() => {
            setStatus("Unable to process QR result", "error");
          });
        },
        () => {
          // ignore frame decode errors for smooth UX
        }
      );

      isScanning = true;
      setStatus("Scanning in progress...", "neutral");
    } catch (error) {
      isScanning = false;
      const message = (error && error.message) || "Camera access failed";
      if (/permission|denied|notallowed/i.test(message)) {
        setStatus("Camera permission denied. Use Upload QR Image.", "error");
      } else if (/secure|https/i.test(message)) {
        setStatus("Camera needs HTTPS or localhost.", "error");
      } else {
        setStatus("Unable to start camera scanner", "error");
      }
    }
  };

  const stopScanner = async () => {
    if (!scanner || !isScanning) {
      return;
    }

    try {
      await scanner.stop();
      await scanner.clear();
    } catch {
      // ignore stop errors
    } finally {
      isScanning = false;
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

  const scanFromImage = async (file) => {
    if (!file) {
      return;
    }

    await stopScanner();
    resetResultBox();
    elements.copyBtn.classList.add("d-none");
    setStatus("Reading QR image...", "neutral");

    try {
      const qrScanner = ensureScanner();
      const decodedText = await qrScanner.scanFile(file, true);
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

  const registerServiceWorker = async () => {
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("service-worker.js");
      } catch {
        // keep app functional even if SW registration fails
      }
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

    window.addEventListener("beforeunload", () => {
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
