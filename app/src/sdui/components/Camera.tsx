/**
 * Camera: the viewfinder, and the code scanner (pure/SPEC.md 2.10, B10; the camera usage text in this store build
 * already covers scanning, rider R9).
 *
 * `mode: "photo"` is a preview that takes a picture when the screen says to; `mode: "scan"` reads codes and hands
 * each one to the screen once. This is what finishes the `scanQR` stub: expo-camera's barcode scanner is on by
 * default in its plugin, so scanning needed no native work on either platform.
 *
 * TWO RULES THIS NODE KEEPS.
 *
 * It never asks for the permission itself. Asking is an action, with the card that must come before it
 * (Apple 5.1.1(iv), the `primed` rule), and that belongs to the renderer and the server. This node reports what the
 * permission is (`onPermission`) and draws whatever the node holds until it is granted — which is where the server
 * puts its own "let X0 see" card.
 *
 * It never hands the same code to the screen twice in a row (mediaCore.ScanGate). A camera pointed at a QR code
 * reads it thirty times a second, and an action fired thirty times is a navigation loop, or thirty payments.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { CompProps } from "./props";
import { useV3Host } from "./v3Host";
import { ScanGate, barcodeTypes, cameraFacing, cameraMode, capturedUrl } from "./mediaCore";

export const Camera = ({ node, props, style, children, fire }: CompProps) => {
  const host = useV3Host();
  const [permission] = useCameraPermissions();
  const mode = cameraMode(props.mode);
  const view = useRef<CameraView>(null);
  const gate = useRef(new ScanGate());
  const shooting = useRef(false);
  const told = useRef<string | null>(null);

  // What the permission is, once, and again whenever it changes: the screen decides what to draw about it.
  const status = permission === null ? "unknown" : permission.granted ? "granted" : permission.canAskAgain ? "unasked" : "blocked";
  useEffect(() => {
    if (status === "unknown" || told.current === status) return;
    told.current = status;
    fire("onChange", status);
    const into = typeof props.permissionInto === "string" ? props.permissionInto : "";
    if (host && into) host.setState(into, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // A screen that comes back counts the code it already read as new.
  useEffect(() => {
    const g = gate.current;
    return () => g.reset();
  }, []);

  /**
   * THE PREVIEW STARTING IS NOT A RESULT.
   *
   * It used to fire `onResult`, the same event a scan fires. A scan screen wired as onResult -> callEndpoint with
   * `event.data` therefore ran once, with nothing, the moment the preview appeared. Now the preview says so in
   * state only (`readyInto`), and `onResult` means one thing: a code was read.
   */
  const onReady = useCallback(() => {
    const into = typeof props.readyInto === "string" ? props.readyInto : "";
    if (host && into) host.setState(into, true);
  }, [host, props.readyInto]);

  const onScan = useCallback((result: { type?: string; data?: string }) => {
    const scan = gate.current.take(result?.type, result?.data, Date.now());
    if (!scan) return;
    const into = typeof props.scanInto === "string" ? props.scanInto : "";
    if (host && into) host.setState(into, scan);
    fire("onResult", scan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, props.scanInto, fire]);

  /**
   * TAKING THE PICTURE IS A STATE CHANGE, NOT A TAP.
   *
   * The shutter is the server's to draw — a button, a countdown, a rule. So the screen sets its own flag true, this
   * node sees it, takes the picture, fires `onCapture` with the file, and puts the flag back to false so the next
   * true means the next picture. The file goes no further from here: uploading it is `uploadFile`, an action.
   */
  const capture = props.capture === true;
  useEffect(() => {
    if (!capture || mode !== "photo" || shooting.current || !view.current) return;
    shooting.current = true;
    let gone = false;
    const reset = () => {
      const path = node.bind?.capture;
      if (host && typeof path === "string" && path) host.setState(path, false);
      shooting.current = false;
    };
    view.current
      .takePictureAsync({ quality: Number(props.quality) > 0 ? Math.min(1, Number(props.quality)) : 0.7, skipProcessing: true })
      .then((pic) => {
        if (gone) return;
        const uri = capturedUrl(pic?.uri);
        if (uri) fire("onComplete", { uri, width: pic?.width ?? 0, height: pic?.height ?? 0 });
        else fire("onError");
      })
      .catch(() => { if (!gone) fire("onError"); })
      .finally(() => { if (!gone) reset(); });
    return () => { gone = true; shooting.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture, mode]);

  // Not granted (or not answered yet): the node's own children, which is where the server's card goes.
  if (!permission?.granted) return <View style={style}>{children}</View>;

  return (
    <CameraView
      ref={view}
      style={style}
      facing={cameraFacing(props.facing)}
      mode="picture"
      active={props.active !== false}
      zoom={Number(props.zoom) > 0 ? Math.min(1, Number(props.zoom)) : 0}
      enableTorch={props.torch === true}
      mute
      animateShutter={props.animateShutter !== false}
      barcodeScannerSettings={mode === "scan" ? { barcodeTypes: barcodeTypes(props.barcodeTypes) } : undefined}
      onBarcodeScanned={mode === "scan" ? onScan : undefined}
      onCameraReady={onReady}
      onMountError={() => fire("onError")}
    >
      {children}
    </CameraView>
  );
};
