import Foundation
import Vision
import AppKit

// 用法：./facedet <圖片路徑>...   輸出每張圖的臉部框（正規化座標）JSON
var out: [[String: Any]] = []

for path in CommandLine.arguments.dropFirst() {
    var entry: [String: Any] = ["path": path]
    guard let img = NSImage(contentsOfFile: path),
          let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cg = rep.cgImage else {
        entry["error"] = "load"
        out.append(entry)
        continue
    }
    entry["w"] = cg.width
    entry["h"] = cg.height
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([req])
        var faces: [[String: Double]] = []
        for o in (req.results ?? []) {
            let b = o.boundingBox
            faces.append(["x": Double(b.origin.x), "y": Double(b.origin.y),
                          "w": Double(b.width), "h": Double(b.height)])
        }
        entry["faces"] = faces
    } catch {
        entry["error"] = "vision"
    }
    out.append(entry)
}

let data = try JSONSerialization.data(withJSONObject: out, options: [])
FileHandle.standardOutput.write(data)
