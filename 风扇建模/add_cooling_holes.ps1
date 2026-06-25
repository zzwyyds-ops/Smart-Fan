param(
    [int]$Rows = 2,
    [int]$Columns = 4,
    [double]$DiameterMm = 6.0,
    [double]$MarginXmm = 14.0,
    [double]$MarginYmm = 18.0,
    [string]$FeatureName = "CoolingHoles"
)

$ErrorActionPreference = "Stop"

$sldworksDll = "D:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SolidWorks.Interop.sldworks.dll"
$swconstDll = "D:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\SolidWorks.Interop.swconst.dll"

[Reflection.Assembly]::LoadFrom($sldworksDll) | Out-Null
[Reflection.Assembly]::LoadFrom($swconstDll) | Out-Null

if (-not ("SwCoolingHoleTool" -as [type])) {
    $code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

public static class SwCoolingHoleTool
{
    public static string AddCoolingHoles(
        int rows,
        int columns,
        double diameterMm,
        double marginXmm,
        double marginYmm,
        string featureName)
    {
        if (rows < 1 || columns < 1)
            throw new ArgumentException("Rows and columns must be positive.");

        var app = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
        var model = (IModelDoc2)app.IActiveDoc2;
        if (model == null)
            throw new InvalidOperationException("No active SOLIDWORKS document.");

        if (model.GetType() != (int)swDocumentTypes_e.swDocPART)
            throw new InvalidOperationException("Active document is not a part.");

        var part = (IPartDoc)model;
        var bodies = (object[])part.GetBodies2((int)swBodyType_e.swSolidBody, false);
        if (bodies == null || bodies.Length == 0)
            throw new InvalidOperationException("No solid body found in active part.");

        var target = FindLargestTopFace((IBody2)bodies[0]);
        if (target == null)
            throw new InvalidOperationException("Could not find a planar outer face for cooling holes.");

        double[] box = (double[])target.GetBox();
        double minX = box[0];
        double minY = box[1];
        double maxX = box[3];
        double maxY = box[4];
        double faceZ = box[5];

        double marginX = marginXmm / 1000.0;
        double marginY = marginYmm / 1000.0;
        double radius = diameterMm / 2000.0;

        if ((maxX - minX) <= ((marginX * 2.0) + (radius * 2.0)))
            throw new InvalidOperationException("X margin and hole size do not fit the target face.");
        if ((maxY - minY) <= ((marginY * 2.0) + (radius * 2.0)))
            throw new InvalidOperationException("Y margin and hole size do not fit the target face.");

        model.ClearSelection2(true);
        ((IEntity)target).Select(false);

        var sketchManager = model.SketchManager;
        sketchManager.InsertSketch(true);

        double startX = columns == 1 ? (minX + maxX) / 2.0 : minX + marginX;
        double startY = rows == 1 ? (minY + maxY) / 2.0 : minY + marginY;
        double stepX = columns == 1 ? 0.0 : ((maxX - minX) - (marginX * 2.0)) / (columns - 1);
        double stepY = rows == 1 ? 0.0 : ((maxY - minY) - (marginY * 2.0)) / (rows - 1);

        for (int row = 0; row < rows; row++)
        {
            for (int column = 0; column < columns; column++)
            {
                double x = startX + (column * stepX);
                double y = startY + (row * stepY);
                sketchManager.CreateCircleByRadius(x, y, faceZ, radius);
            }
        }

        sketchManager.InsertSketch(true);
        model.ClearSelection2(true);

        var feature = model.FeatureManager.FeatureCut4(
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

        if (feature == null)
            throw new InvalidOperationException("FeatureCut4 failed to create the cut.");

        feature.Name = featureName;
        model.EditRebuild3();

        return string.Format(
            "Added {0} holes on face {1:0.##}mm x {2:0.##}mm (diameter {3:0.##}mm, {4}x{5}).",
            rows * columns,
            (maxX - minX) * 1000.0,
            (maxY - minY) * 1000.0,
            diameterMm,
            rows,
            columns
        );
    }

    private static IFace2 FindLargestTopFace(IBody2 body)
    {
        var faces = (object[])body.GetFaces();
        IFace2 bestFace = null;
        double bestArea = double.MinValue;
        double bestTopZ = double.MinValue;

        foreach (object faceObject in faces)
        {
            var face = (IFace2)faceObject;
            var surface = (ISurface)face.GetSurface();
            if (surface == null || !surface.IsPlane())
                continue;

            double[] box = (double[])face.GetBox();
            double widthX = Math.Abs(box[3] - box[0]);
            double widthY = Math.Abs(box[4] - box[1]);
            double widthZ = Math.Abs(box[5] - box[2]);
            double area = face.GetArea();

            bool isBroadHorizontalFace = widthX > 0.01 && widthY > 0.01 && widthZ < 0.00001;
            if (!isBroadHorizontalFace)
                continue;

            if (area > bestArea + 1e-9 || (Math.Abs(area - bestArea) < 1e-9 && box[5] > bestTopZ))
            {
                bestFace = face;
                bestArea = area;
                bestTopZ = box[5];
            }
        }

        return bestFace;
    }
}
'@

    Add-Type -ReferencedAssemblies $sldworksDll, $swconstDll -TypeDefinition $code | Out-Null
}

[SwCoolingHoleTool]::AddCoolingHoles($Rows, $Columns, $DiameterMm, $MarginXmm, $MarginYmm, $FeatureName)
