param(
    [double]$HoleDiameterMm = 5.0,
    [double]$WebMm = 3.0,
    [double]$MarginXmm = 8.0,
    [double]$MarginYmm = 8.0,
    [string]$FeatureName = "HoneycombCooling"
)

$ErrorActionPreference = "Stop"

$sldworksDll = "D:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SolidWorks.Interop.sldworks.dll"
$swconstDll = "D:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SolidWorks.Interop.swconst.dll"

[Reflection.Assembly]::LoadFrom($sldworksDll) | Out-Null
[Reflection.Assembly]::LoadFrom($swconstDll) | Out-Null

if (-not ("SwHoneycombTool" -as [type])) {
    $code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

public static class SwHoneycombTool
{
    public static string Build(
        double holeDiameterMm,
        double webMm,
        double marginXmm,
        double marginYmm,
        string featureName)
    {
        var app = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
        var model = (IModelDoc2)app.IActiveDoc2;
        if (model == null)
            throw new InvalidOperationException("No active SOLIDWORKS document.");

        if (model.GetType() != (int)swDocumentTypes_e.swDocPART)
            throw new InvalidOperationException("Active document is not a part.");

        DeleteFeatureIfExists(model, "HoneycombCooling");
        DeleteFeatureIfExists(model, "CoolingHoles");
        DeleteSketchIfTrailing(model);

        var part = (IPartDoc)model;
        var bodies = (object[])part.GetBodies2((int)swBodyType_e.swSolidBody, false);
        if (bodies == null || bodies.Length == 0)
            throw new InvalidOperationException("No solid body found.");

        var targetFace = FindLargestBroadPlanarFace((IBody2)bodies[0]);
        if (targetFace == null)
            throw new InvalidOperationException("Could not find target planar face.");

        double[] box = (double[])targetFace.GetBox();
        double minX = box[0];
        double minY = box[1];
        double maxX = box[3];
        double maxY = box[4];
        double faceZ = box[5];

        double diameter = holeDiameterMm / 1000.0;
        double radius = diameter / 2.0;
        double web = webMm / 1000.0;
        double marginX = marginXmm / 1000.0;
        double marginY = marginYmm / 1000.0;

        double pitchX = diameter + web;
        double pitchY = pitchX * Math.Sqrt(3.0) / 2.0;

        double usableWidth = (maxX - minX) - (marginX * 2.0);
        double usableHeight = (maxY - minY) - (marginY * 2.0);
        if (usableWidth <= diameter || usableHeight <= diameter)
            throw new InvalidOperationException("Margins leave no room for honeycomb holes.");

        int longRowCount = Math.Max(2, (int)Math.Floor(usableWidth / pitchX) + 1);
        int shortRowCount = Math.Max(1, longRowCount - 1);
        int rowCount = Math.Max(2, (int)Math.Floor(usableHeight / pitchY) + 1);

        double usedWidthLong = (longRowCount - 1) * pitchX;
        double usedWidthShort = shortRowCount > 1 ? (shortRowCount - 1) * pitchX : 0.0;
        double usedHeight = (rowCount - 1) * pitchY;

        double startY = minY + ((maxY - minY) - usedHeight) / 2.0;

        model.ClearSelection2(true);
        ((IEntity)targetFace).Select(false);
        model.SketchManager.InsertSketch(true);

        int holeCount = 0;
        for (int row = 0; row < rowCount; row++)
        {
            bool isOffsetRow = (row % 2) == 1;
            int columnCount = isOffsetRow ? shortRowCount : longRowCount;
            double rowWidth = isOffsetRow ? usedWidthShort : usedWidthLong;
            double startX = minX + ((maxX - minX) - rowWidth) / 2.0;
            if (isOffsetRow && columnCount > 1)
                startX += pitchX / 2.0;

            double y = startY + (row * pitchY);
            for (int column = 0; column < columnCount; column++)
            {
                double x = startX + (column * pitchX);
                model.SketchManager.CreateCircleByRadius(x, y, faceZ, radius);
                holeCount++;
            }
        }

        model.SketchManager.InsertSketch(true);

        var sketchFeature = GetLastFeature(model);
        if (sketchFeature == null || sketchFeature.GetTypeName2() != "ProfileFeature")
            throw new InvalidOperationException("Failed to create honeycomb sketch.");

        model.ClearSelection2(true);
        ((IEntity)sketchFeature).Select(false);

        var cut = model.FeatureManager.FeatureCut4(
            true,
            false,
            false,
            (int)swEndConditions_e.swEndCondThroughAll,
            (int)swEndConditions_e.swEndCondBlind,
            0.0,
            0.0,
            false,
            false,
            false,
            false,
            0.0,
            0.0,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            (int)swStartConditions_e.swStartSketchPlane,
            0.0,
            false,
            true
        );

        if (cut == null)
            throw new InvalidOperationException("Failed to cut honeycomb holes.");

        cut.Name = featureName;
        model.EditRebuild3();

        return string.Format(
            "Honeycomb created: {0} holes, diameter {1:0.##} mm, web {2:0.##} mm, rows {3}.",
            holeCount,
            holeDiameterMm,
            webMm,
            rowCount
        );
    }

    private static IFace2 FindLargestBroadPlanarFace(IBody2 body)
    {
        var faces = (object[])body.GetFaces();
        IFace2 bestFace = null;
        double bestArea = double.MinValue;
        double bestDepth = double.MaxValue;

        foreach (object faceObject in faces)
        {
            var face = (IFace2)faceObject;
            var surface = (ISurface)face.GetSurface();
            if (surface == null || !surface.IsPlane())
                continue;

            double[] box = (double[])face.GetBox();
            double dx = Math.Abs(box[3] - box[0]);
            double dy = Math.Abs(box[4] - box[1]);
            double dz = Math.Abs(box[5] - box[2]);
            double minDim = Math.Min(dx, Math.Min(dy, dz));
            double area = face.GetArea();

            if (area > bestArea + 1e-9 || (Math.Abs(area - bestArea) < 1e-9 && minDim < bestDepth))
            {
                bestFace = face;
                bestArea = area;
                bestDepth = minDim;
            }
        }

        return bestFace;
    }

    private static void DeleteFeatureIfExists(IModelDoc2 model, string featureName)
    {
        for (var feat = (Feature)model.FirstFeature(); feat != null; feat = (Feature)feat.GetNextFeature())
        {
            if (string.Equals(feat.Name, featureName, StringComparison.OrdinalIgnoreCase))
            {
                model.ClearSelection2(true);
                ((IEntity)feat).Select(false);
                model.EditDelete();
                return;
            }
        }
    }

    private static void DeleteSketchIfTrailing(IModelDoc2 model)
    {
        var last = GetLastFeature(model);
        if (last != null && last.GetTypeName2() == "ProfileFeature")
        {
            model.ClearSelection2(true);
            ((IEntity)last).Select(false);
            model.EditDelete();
        }
    }

    private static Feature GetLastFeature(IModelDoc2 model)
    {
        Feature last = null;
        for (var feat = (Feature)model.FirstFeature(); feat != null; feat = (Feature)feat.GetNextFeature())
            last = feat;
        return last;
    }
}
'@

    Add-Type -ReferencedAssemblies $sldworksDll, $swconstDll -TypeDefinition $code | Out-Null
}

[SwHoneycombTool]::Build($HoleDiameterMm, $WebMm, $MarginXmm, $MarginYmm, $FeatureName)
