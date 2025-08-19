"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type AttendanceEntry = {
	name: string;
	deviceId: string;
	timestamp: string; // ISO string
};

const ATTENDANCE_STORAGE_KEY = "attendance:list";
const DEVICE_ID_STORAGE_KEY = "attendance:deviceId";

function getOrCreateDeviceId(): string {
	if (typeof window === "undefined") return "";
	let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
	if (!deviceId) {
		try {
			deviceId = crypto.randomUUID();
		} catch {
			deviceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		}
		localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
	}
	return deviceId;
}

function readAttendance(): AttendanceEntry[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(ATTENDANCE_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as AttendanceEntry[]) : [];
	} catch {
		return [];
	}
}

function writeAttendance(entries: AttendanceEntry[]) {
	if (typeof window === "undefined") return;
	localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(entries));
}

export default function HomePage() {
	const [entries, setEntries] = useState<AttendanceEntry[]>([]);
	const [manualName, setManualName] = useState("");
	const [scanError, setScanError] = useState<string | null>(null);
	const [infoMessage, setInfoMessage] = useState<string | null>(null);
	const [justScanned, setJustScanned] = useState(false);
	const deviceIdRef = useRef<string>("");

	useEffect(() => {
		deviceIdRef.current = getOrCreateDeviceId();
		setEntries(readAttendance());
	}, []);

	const addEntry = useCallback((nameRaw: string) => {
		const name = nameRaw.trim();
		if (!name) return;
 
 		// Prevent duplicates by name (case-insensitive)
 		const exists = entries.some(
 			(e) => e.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
 		);
 		if (exists) return;
 
 		const newEntry: AttendanceEntry = {
 			name,
 			deviceId: deviceIdRef.current,
 			timestamp: new Date().toISOString(),
 		};
 		const updated = [newEntry, ...entries];
 		setEntries(updated);
 		writeAttendance(updated);
 	}, [entries]);

	const handleDecode = useCallback(
		(result: string) => {
			if (justScanned) return; // debounce burst scans
			setJustScanned(true);
			setTimeout(() => setJustScanned(false), 1200);

			setScanError(null);
			setInfoMessage(null);

			let parsed: { name?: string; deviceId?: string } | null = null;
			try {
				parsed = JSON.parse(result);
			} catch {
				// fallback: treat as plain name if not JSON
				parsed = { name: result };
			}
			const incomingName = (parsed && parsed.name ? parsed.name : "").trim();
			const incomingDeviceId = (parsed && parsed.deviceId ? parsed.deviceId : "").trim();

			if (!incomingName) {
				setScanError("QR does not contain a valid name.");
				return;
			}

			// Enforce one entry per device if deviceId present
			if (incomingDeviceId) {
				const already = entries.some((e) => e.deviceId === incomingDeviceId);
				if (already) {
					setScanError("This device has already checked in.");
					return;
				}
			}

			addEntry(incomingName);
		},
		[addEntry, entries, justScanned]
	);

	const handleManualAdd = useCallback(() => {
		if (!manualName.trim()) return;
		addEntry(manualName);
		setManualName("");
	}, [addEntry, manualName]);

	const exportExcel = useCallback(() => {
 		const worksheet = XLSX.utils.json_to_sheet(
 			entries.map((e) => ({
 				Name: e.name,
 				Device: e.deviceId,
 				Time: new Date(e.timestamp).toLocaleString(),
 			}))
 		);
 		const workbook = XLSX.utils.book_new();
 		XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
 		XLSX.writeFile(workbook, "attendance.xlsx");
 	}, [entries]);

	const exportPdf = useCallback(() => {
 		const doc = new jsPDF();
 		doc.text("Attendance", 14, 16);
 		autoTable(doc, {
 			head: [["#", "Name", "Device", "Time"]],
 			body: entries.map((e, idx) => [
 				String(idx + 1),
 				e.name,
 				e.deviceId,
 				new Date(e.timestamp).toLocaleString(),
 			]),
 			startY: 22,
 		});
 		doc.save("attendance.pdf");
 	}, [entries]);

	const clearAll = useCallback(() => {
		setEntries([]);
		localStorage.removeItem(ATTENDANCE_STORAGE_KEY);
		localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
		// Regenerate a fresh device ID and update the ref
		deviceIdRef.current = getOrCreateDeviceId();
		setManualName("");
		setScanError(null);
		setInfoMessage(null);
		writeAttendance([]);
	}, []);

	const sortedEntries = useMemo(
 		() => [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
 		[entries]
 	);

	return (
 		<div style={{ maxWidth: 920, margin: "0 auto", padding: "24px" }}>
 			<h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>QR Attendance</h1>
 			<p style={{ color: "#555", marginBottom: 16 }}>
 				Organizer scans attendance and saves it here. Students can generate their QR at <a href="/student" style={{ color: "#2563eb" }}>/student</a>.
 			</p>

 			<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
 				<span style={{ fontWeight: 600 }}>Organizer lock:</span>
 				<span style={{ color: "#059669" }}>Unlocked</span>
 			</div>

 			<div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
 				<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
 					<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Scan QR</h3>
 					<div style={{ overflow: "hidden", borderRadius: 8 }}>
 						<Scanner
 							onScan={(codes) => {
 								const value = Array.isArray(codes) && codes.length > 0 ? codes[0].rawValue : "";
 								if (value) handleDecode(value);
 							}}
 							onError={(err: unknown) => {
 								const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Camera error";
 								setScanError(String(message));
 							}}
 							constraints={{ facingMode: "environment" }}
 							styles={{
 								container: { width: "100%" },
 								video: { width: "100%", borderRadius: 8 },
 							}}
 						/>
 					</div>
 					{scanError && (
 						<div style={{ color: "#b91c1c", marginTop: 8 }}>{scanError}</div>
 					)}
 					{infoMessage && (
 						<div style={{ color: "#059669", marginTop: 8 }}>{infoMessage}</div>
 					)}
 				</div>

 				<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
 					<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Manual entry</h3>
 					<div style={{ display: "flex", gap: 8 }}>
 						<input
 							type="text"
 							placeholder="Full name"
 							value={manualName}
 							onChange={(e) => setManualName(e.target.value)}
 							style={{ flex: 1, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8 }}
 						/>
 						<button
 							onClick={handleManualAdd}
 							style={{
 								padding: "10px 14px",
 								background: "#111827",
 								color: "white",
 								border: 0,
 								borderRadius: 8,
 								cursor: "pointer",
 							}}
 						>
 							Add
 						</button>
 					</div>
 				</div>
 			</div>

 			<div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
 				<button onClick={exportExcel} style={{ padding: "10px 14px", background: "#2563eb", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}>
 					Export Excel
 				</button>
 				<button onClick={exportPdf} style={{ padding: "10px 14px", background: "#059669", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}>
 					Export PDF
 				</button>
 				<button onClick={clearAll} style={{ padding: "10px 14px", background: "#ef4444", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}>
 					Clear List
 				</button>
 			</div>

 			<div style={{ marginTop: 20 }}>
 				<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Attendance ({sortedEntries.length})</h3>
 				<div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12 }}>
 					<table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
 						<thead>
 							<tr style={{ background: "#f9fafb", textAlign: "left" }}>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid rgb(32, 32, 32)" }}>#</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid rgb(32, 32, 32)" }}>Name</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid rgb(32, 32, 32)" }}>Device</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid rgb(32, 32, 32)" }}>Time</th>
 							</tr>
 						</thead>
 						<tbody>
 							{sortedEntries.map((e, idx) => (
 								<tr key={`${e.name}-${e.timestamp}`}>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>{idx + 1}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>{e.name}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{e.deviceId}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>{new Date(e.timestamp).toLocaleString()}</td>
 								</tr>
 							))}
 							{sortedEntries.length === 0 && (
 								<tr>
 									<td colSpan={4} style={{ padding: "12px", color: "#6b7280" }}>No entries yet.</td>
 								</tr>
 							)}
 						</tbody>
 					</table>
 				</div>
 			</div>
 		</div>
 	);
}


