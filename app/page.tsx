"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ScannedItem = {
    deviceId: string;
    rawData: string;
    name: string | null;
    metadata: Record<string, unknown> | null;
    scannedAt: number; // epoch ms
};

const LOCAL_STORAGE_KEY = "qratt:scans";

function parseDeviceIdFromQrPayload(payload: string): {
    deviceId: string;
    name: string | null;
    metadata: Record<string, unknown> | null;
} {
    const trimmed = payload.trim();
    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        // Attempt to extract a human-friendly name
        const nameCandidateKeys = [
            "name",
            "fullName",
            "studentName",
            "student_name",
            "ownerName",
            "owner",
            "userName",
            "username",
            "firstName",
            "lastName",
        ];
        let extractedName: string | null = null;
        for (const key of nameCandidateKeys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const value = (parsed as any)[key];
                if (typeof value === "string" && value.trim()) {
                    extractedName = value.trim();
                    break;
                }
            }
        }
        // Combine firstName + lastName if available
        if (!extractedName) {
            const first = (parsed as any)["firstName"];
            const last = (parsed as any)["lastName"];
            if (typeof first === "string" && typeof last === "string") {
                const combo = `${first} ${last}`.trim();
                if (combo) extractedName = combo;
            }
        }
        const candidateKeys = [
            "deviceId",
            "deviceID",
            "device_id",
            "id",
            "device",
        ];
        for (const key of candidateKeys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const value = (parsed as any)[key];
                if (typeof value === "string" && value.trim().length > 0) {
                    return { deviceId: value.trim(), name: extractedName, metadata: parsed };
                }
                if (value && typeof value === "object" && (value as any).id) {
                    const nested = String((value as any).id).trim();
                    if (nested.length > 0) {
                        return { deviceId: nested, name: extractedName, metadata: parsed };
                    }
                }
            }
        }
        // Fallback: search any string field that looks like an id
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string" && /id/i.test(key) && value.trim()) {
                return { deviceId: value.trim(), name: extractedName, metadata: parsed };
            }
        }
        // As a last resort, treat full JSON string as the id
        return { deviceId: trimmed, name: extractedName, metadata: parsed };
    } catch {
        // Not JSON; treat full string as the id
        return { deviceId: trimmed, name: null, metadata: null };
    }
}

export default function HomePage() {
    const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
    const [isScanning, setIsScanning] = useState<boolean>(true);
    const [statusMessage, setStatusMessage] = useState<string>(
        "Align a QR code within the frame"
    );
    const lastRawRef = useRef<string>("");
    const lastTimeRef = useRef<number>(0);

    // Load existing scans from localStorage on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as ScannedItem[];
                if (Array.isArray(parsed)) {
                    setScannedItems(parsed);
                }
            }
        } catch {
            // ignore malformed storage
        }
    }, []);

    // Persist on change
    useEffect(() => {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scannedItems));
        } catch {
            // ignore quota errors
        }
    }, [scannedItems]);

    const deviceIdSet = useMemo(() => {
        return new Set(scannedItems.map((item) => item.deviceId));
    }, [scannedItems]);

    const handleDecoded = useCallback(
        (decodedText: string) => {
            const now = Date.now();
            // Debounce identical results fired rapidly by the scanner
            if (
                lastRawRef.current === decodedText &&
                now - lastTimeRef.current < 1500
            ) {
                return;
            }
            lastRawRef.current = decodedText;
            lastTimeRef.current = now;

            const { deviceId, name, metadata } = parseDeviceIdFromQrPayload(decodedText);
            if (!deviceId) {
                setStatusMessage("No device id found in QR");
                return;
            }
            if (deviceIdSet.has(deviceId)) {
                setStatusMessage(`Duplicate ignored: ${deviceId}`);
                return;
            }

            const newItem: ScannedItem = {
                deviceId,
                rawData: decodedText,
                name: name ?? null,

                metadata,
                scannedAt: now,
            };
            setScannedItems((prev) => [newItem, ...prev]);
            setStatusMessage(`Saved: ${deviceId}`);
        },
        [deviceIdSet]
    );

    const handleError = useCallback((error: unknown) => {
        setStatusMessage(
            error instanceof Error ? error.message : "Camera error while scanning"
        );
    }, []);

    const removeItem = useCallback((deviceId: string) => {
        setScannedItems((prev) => prev.filter((i) => i.deviceId !== deviceId));
    }, []);

    const clearAll = useCallback(() => {
        setScannedItems([]);
        setStatusMessage("All scans cleared");
    }, []);

    const exportToExcel = useCallback(() => {
        const rows = scannedItems
            .slice()
            .reverse()
            .map((item) => ({
                "Device ID": item.deviceId,
                "Scanned At": new Date(item.scannedAt).toLocaleString(),
                "Name": item.name ?? "",
            }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Scans");
        XLSX.writeFile(workbook, "scans.xlsx");
    }, [scannedItems]);

    const exportToPdf = useCallback(() => {
        const doc = new jsPDF();
        const rows = scannedItems
            .slice()
            .reverse()
            .map((item) => [
                item.deviceId,
                new Date(item.scannedAt).toLocaleString(),
                item.name ?? "",
            ]);
        autoTable(doc, {
            head: [["Device ID", "Scanned At", "Name"]],
            body: rows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [40, 40, 40] },
            startY: 14,
            margin: { left: 10, right: 10 },
        });
        doc.text("QR Scans", 10, 10);
        doc.save("scans.pdf");
    }, [scannedItems]);

    return (
        <main style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                QR Scanner & Export
            </h1>
            <p style={{ color: "#555", marginBottom: 16 }}>{statusMessage}</p>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 16,
                    marginBottom: 16,
                }}
            >
                <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                            onClick={() => setIsScanning((s) => !s)}
                            style={{
                                padding: "8px 12px",
                                background: isScanning ? "#ef4444" : "#10b981",
                                color: "white",
                                border: 0,
                                borderRadius: 6,
                                cursor: "pointer",
                            }}
                        >
                            {isScanning ? "Stop Scanner" : "Start Scanner"}
                        </button>

                        <button
                            onClick={clearAll}
                            style={{
                                padding: "8px 12px",
                                background: "#6b7280",
                                color: "white",
                                border: 0,
                                borderRadius: 6,
                                cursor: "pointer",
                            }}
                        >
                            Clear All
                        </button>

                        <div style={{ flex: 1 }} />

                        <button
                            onClick={exportToExcel}
                            style={{
                                padding: "8px 12px",
                                background: "#2563eb",
                                color: "white",
                                border: 0,
                                borderRadius: 6,
                                cursor: "pointer",
                            }}
                        >
                            Export Excel
                        </button>
                        <button
                            onClick={exportToPdf}
                            style={{
                                padding: "8px 12px",
                                background: "#111827",
                                color: "white",
                                border: 0,
                                borderRadius: 6,
                                cursor: "pointer",
                            }}
                        >
                            Export PDF
                        </button>
                    </div>

                    {isScanning && (
                        <div style={{ marginTop: 12 }}>
                            <Scanner
                                onScan={(detected) => {
                                    const first = Array.isArray(detected) ? detected[0] : undefined;
                                    const text = first?.rawValue || "";
                                    if (text) handleDecoded(text);
                                }}
                                onError={handleError}
                                constraints={{ facingMode: "environment" }}
                            />
                        </div>
                    )}
                </div>

                <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                        Saved Scans ({scannedItems.length})
                    </h2>
                    {scannedItems.length === 0 ? (
                        <p style={{ color: "#666" }}>No scans yet.</p>
                    ) : (
                        <div style={{ overflowX: "auto" }}>
                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: 14,
                                }}
                            >
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>
                                            #
                                        </th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>
                                            Device ID
                                        </th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>
                                            Scanned At
                                        </th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>
                                            Name
                                        </th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scannedItems.map((item, index) => (
                                        <tr key={item.deviceId}>
                                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                                                {scannedItems.length - index}
                                            </td>
                                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontWeight: 600 }}>
                                                {item.deviceId}
                                            </td>
                                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                {item.name ?? ""}
                                            </td>
                                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                {new Date(item.scannedAt).toLocaleString()}
                                            </td>

                                            <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                <button
                                                    onClick={() => removeItem(item.deviceId)}
                                                    style={{
                                                        padding: "6px 10px",
                                                        background: "#ef4444",
                                                        color: "white",
                                                        border: 0,
                                                        borderRadius: 6,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Remove
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}


