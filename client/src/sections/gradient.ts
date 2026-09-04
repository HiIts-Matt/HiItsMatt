/**
 * Exported straight from shadergradient.co. `ShaderGradient` parses this with
 * `control="query"`, so changing the gradient means pasting a new URL here and
 * nothing else — do not hand-tune the individual params.
 *
 * `animate=on` is swapped to `animate=off` at the call site for reduced-motion
 * users: the shader runs its own render loop, which CSS cannot reach.
 *
 * Framing note: the camera looks down the plane diagonally (cPolarAngle 78,
 * cAzimuthAngle 200), which trades a harsher ridgeline for a smaller margin
 * before the mesh boundary enters frame at very wide aspect ratios. uStrength
 * is deliberately modest because vertex displacement is what drags that edge
 * into view; detail comes from uDensity instead.
 */
export const GRADIENT_URL =
  "https://www.shadergradient.co/customize?animate=on&axesHelper=off&brightness=0.8&cAzimuthAngle=200&cDistance=5&cPolarAngle=78&cameraZoom=1&color1=%23fb0aff&color2=%23210dff&color3=%2300009f&destination=onCanvas&embedMode=off&envPreset=city&format=gif&fov=45&frameRate=10&gizmoHelper=hide&grain=off&lightType=3d&pixelDensity=1&positionX=-0.6&positionY=0&positionZ=0&range=disabled&rangeEnd=40&rangeStart=0&reflection=0.1&rotationX=0&rotationY=10&rotationZ=50&shader=defaults&type=waterPlane&uAmplitude=1.2&uDensity=1.9&uFrequency=6.5&uSpeed=0.05&uStrength=2.4&uTime=0&wireframe=false&zoomOut=false";
