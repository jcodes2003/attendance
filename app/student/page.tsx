"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";

export default function StudentPage() {
	const [name, setName] = useState<string>("");
	const svgRef = useRef<SVGSVGElement | null>(null);

	useEffect(() => {
		const saved = localStorage.getItem("student:name");
		if (saved) setName(saved);
	}, []);

	useEffect(() => {
		localStorage.setItem("student:name", name);
	}, [name]);

	const qrValue = useMemo(() => name.trim(), [name]);

	const downloadPng = useCallback(async () => {
		if (!qrValue || !svgRef.current) return;
		const svg = svgRef.current;
		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(svg);
		const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

		const image = new Image();
		const scale = 8; // upscale for crisp export
		const size = (svg.viewBox && svg.viewBox.baseVal?.width) || svg.clientWidth || 256;
		const canvas = document.createElement("canvas");
		canvas.width = size * scale;
		canvas.height = size * scale;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		await new Promise<void>((resolve, reject) => {
			image.onload = () => {
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
				resolve();
			};
			image.onerror = () => reject(new Error("Failed to render SVG"));
			image.src = svgDataUrl;
		});

		const url = canvas.toDataURL("image/png");
		const a = document.createElement("a");
		a.href = url;
		a.download = `qr-${qrValue.replace(/\s+/g, "_")}.png`;
		a.click();
	}, [qrValue]);

	return (
		<div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
			<h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Student QR Generator</h1>
			<p style={{ color: "#555", marginBottom: 16 }}>
				Type your name to generate a QR code. Show it to the organizer to scan.
			</p>

			<div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
				<input
					type="text"
					placeholder="Full name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					style={{ flex: 1, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8 }}
				/>
				<button
					onClick={downloadPng}
					disabled={!qrValue}
					style={{ padding: "10px 14px", background: qrValue ? "#111827" : "#9ca3af", color: "#fff", border: 0, borderRadius: 8, cursor: qrValue ? "pointer" : "not-allowed" }}
				>
					Download PNG
				</button>
			</div>

			<div style={{ background: "white", padding: 16, display: "inline-block", borderRadius: 12, border: "1px solid #e5e7eb" }}>
				{qrValue ? (
					<QRCode
						ref={svgRef as any}
						value={qrValue}
						size={240}
						bgColor="#ffffff"
						fgColor="#111827"
						style={{ height: "auto", maxWidth: "100%", width: "240px" }}
					/>
				) : (
					<div style={{ width: 240, height: 240, display: "grid", placeItems: "center", color: "#6b7280" }}>Enter a name to preview</div>
				)}
			</div>

			<div style={{ marginTop: 16 }}>
				<a href="/" style={{ color: "#2563eb" }}>Go to Scanner</a>
			</div>
		</div>
	);
}


