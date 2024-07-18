"use strict";

var vertexShaderSource = `#version 300 es

// an attribute is an input (in) to a vertex shader.
// It will receive data from a buffer
in vec2 a_position;

// Used to pass in the resolution of the canvas
uniform vec2 u_resolution;

// all shaders have a main function
void main() {

  // convert the position from pixels to 0.0 to 1.0
  vec2 zeroToOne = a_position / u_resolution;

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = zeroToOne * 2.0;

  // convert from 0->2 to -1->+1 (clipspace)
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
}
`;

var fragmentShaderSource = `#version 300 es

// fragment shaders don't have a default precision so we need
// to pick one. highp is a good default. It means "high precision"
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_mod_val;
uniform vec3 u_camera_pos;

out vec4 frag_color;

const int OBJECT_COUNT_MAX = 32;
uniform int u_numObjects;

const vec3 light_position = vec3(15.0, 15.0, -5.0);
const int NUMBER_OF_STEPS = 256;
const float MINIMUM_HIT_DISTANCE = 0.01;
const float MAXIMUM_TRACE_DISTANCE = 100.0;

struct WorldObject
{
    vec3 center;
    vec3 size;
    vec3 color;
    float type;
    float is_negated;
    float has_shadow;
    float reflectivity;
    float transparency;
    float diffuse_intensity;
};

layout(std140) uniform WorldData {
    WorldObject objects[OBJECT_COUNT_MAX];  // Adjust size as needed
};

//Object type 1 = sphere
float distance_from_sphere(in vec3 camera, in vec3 center, float radius)
{
    return length(camera - center) - radius;
}

//Object type 2 = wiggle sphere
float distance_from_wiggle_sphere(in vec3 camera, in vec3 center, float radius, float multi)
{
    float displacement = sin(2.0 * camera.x + multi) * sin(3.0 * camera.y + multi * -3.0) * sin(7.0 * camera.z - multi * 0.5) * 0.25;
    return length(camera - center) - radius + displacement;
}

//Object type 3 = plane
float distance_from_plane(in vec3 camera, in vec3 origin, in vec3 normal)
{
    return dot(camera, normal) - dot(origin, normal);
}

//Object type 4 = box
float distance_from_box(in vec3 camera, in vec3 center, in vec3 size)
{
    vec3 d = abs(camera - center) - size;
    return length(max(d, vec3(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

//Object type 5 = wiggle plane
float distance_from_wiggle_plane(in vec3 camera, in vec3 origin, in vec3 normal, float multi)
{
    float displacement = sin(2.0 * camera.x + multi) * sin(3.0 * camera.x + 2.5 * camera.z + multi * -3.0) * sin(7.0 * camera.z - multi * 0.5) * 0.25 * cos(1.0 * camera.x + multi) * cos(0.5 * camera.x + 1.5 * camera.z + multi * -3.0) * cos(2.0 * camera.z - multi * 0.5) * 0.25;
    return dot(camera, normal) - dot(origin, normal) + displacement;
}

float map_the_object(in vec3 p, in WorldObject object)
{
    if (object.type == 1.0)
    {
        return distance_from_sphere(p, object.center, object.size.x);
    }
    else if (object.type == 2.0)
    {
        return distance_from_wiggle_sphere(p, object.center, object.size.x, u_mod_val.y);
    }
    else if (object.type == 3.0)
    {
        return distance_from_plane(p, object.center, object.size);
    }
    else if (object.type == 4.0)
    {
        return distance_from_box(p, object.center, object.size);
    }
    else if (object.type == 5.0)
    {
        return distance_from_wiggle_plane(p, object.center, object.size, u_mod_val.y);
    }

    return 1000000000.0;
}


float[2] map_the_world(in vec3 p)
{

    float[2] min_dist;
    min_dist[0] = 100000.0;
    min_dist[1] = -1.0;
    float cur_dist = 0.0;
    for (int i = 0; i < u_numObjects; ++i)
    {
        cur_dist = map_the_object(p, objects[i]);
        if (cur_dist < min_dist[0]){
            min_dist[0] = cur_dist;
            min_dist[1] = float(i);
        }
    }

    return min_dist;
}

float[2] map_the_world_skip(in vec3 p, in int skip_object)
{

    float[2] min_dist;
    min_dist[0] = 100000.0;
    min_dist[1] = -1.0;
    float cur_dist = 0.0;
    for (int i = 0; i < u_numObjects; ++i)
    {
        if (i == skip_object){
            continue;
        }
        cur_dist = map_the_object(p, objects[i]);
        if (cur_dist < min_dist[0]){
            min_dist[0] = cur_dist;
            min_dist[1] = float(i);
        }
    }

    return min_dist;
}

vec3 calculate_normal(in vec3 p, in WorldObject object)
{
    const vec3 small_step = vec3(0.001, 0.0, 0.0);

    float gradient_x = map_the_object(p + small_step.xyy, object) - map_the_object(p - small_step.xyy, object);
    float gradient_y = map_the_object(p + small_step.yxy, object) - map_the_object(p - small_step.yxy, object);
    float gradient_z = map_the_object(p + small_step.yyx, object) - map_the_object(p - small_step.yyx, object);

    vec3 normal = vec3(gradient_x, gradient_y, gradient_z);

    return normalize(normal);
}

vec3 reflect_ray(in vec3 incident, in vec3 normal){
    return incident - 2.0 * dot(incident, normal) * normal;
}

vec3 ray_march2(in vec3 ro, in vec3 rd, in int skip_object)
{
    float total_distance_traveled = 0.0;

    for (int i = 0; i < NUMBER_OF_STEPS; ++i)
    {
        
        vec3 current_position = ro + total_distance_traveled * rd;

        float[2] distance_to_closest = map_the_world_skip(current_position,  skip_object);

        if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
        {   
            WorldObject current_object = objects[int(distance_to_closest[1])];
            vec3 normal = calculate_normal(current_position, current_object);
            vec3 direction_to_light = normalize(current_position - light_position);

            vec3 current_color;

            if(current_object.color.x == -2.0){
                current_color = normal * 0.5 + 0.5;
            }
            else{
                current_color = current_object.color;
                float diffuse_intensity = max(0.0, dot(normal, direction_to_light));
                current_color = current_color * (1.0 - current_object.diffuse_intensity) + current_color * diffuse_intensity * current_object.diffuse_intensity;
            }
            return current_color * min(1.0, 5.0/total_distance_traveled);
        }

        if (total_distance_traveled > MAXIMUM_TRACE_DISTANCE)
        {
            break;
        }
        total_distance_traveled += distance_to_closest[0];
    }
    return vec3(0.0);
}

// vec3 ray_march2(in vec3 ro, in vec3 rd, in int skip_object)
// {
//     float total_distance_traveled = 0.0;

//     for (int i = 0; i < NUMBER_OF_STEPS; ++i)
//     {
//         vec3 current_position = ro + total_distance_traveled * rd;

//         float[2] distance_to_closest = map_the_world_skip(current_position,  skip_object);

//         if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
//         {   
//             int current_object_index = int(distance_to_closest[1]);
//             WorldObject current_object = objects[current_object_index];
//             vec3 normal = calculate_normal(current_position, current_object);
//             vec3 direction_to_light = normalize(current_position - light_position);

            
//             vec3 current_color;

//             if(current_object.color.x == -2.0){
//                 current_color = normal * 0.5 + 0.5;
//             }
//             else{
//                 current_color = current_object.color;
//                 float diffuse_intensity = max(0.0, dot(normal, direction_to_light));
//                 current_color = current_color * (1.0 - current_object.diffuse_intensity) + current_color * diffuse_intensity * current_object.diffuse_intensity;
//             }

//             if (current_object.reflectivity > 0.0){
//                 float reflectivity = current_object.reflectivity;
//                 current_object.reflectivity = 0.0;
//                 vec3 reflection = ray_march3(current_position, reflect_ray(rd, normal), current_object_index);
//                 current_color = (reflection * reflectivity + (1.0 - reflectivity) * current_color);
//             }

//             if (current_object.transparency > 0.0){
//                 float transparency = current_object.transparency;
//                 current_object.transparency = 0.0;
//                 vec3 transparency_color = ray_march3(current_position, rd, current_object_index);
//                 current_color = transparency_color * transparency + (1.0 - transparency) * current_color;
//             }
//             return current_color * min(1.0, 5.0/total_distance_traveled);
//         }

//         if (total_distance_traveled > MAXIMUM_TRACE_DISTANCE)
//         {
//             break;
//         }
//         total_distance_traveled += distance_to_closest[0];
//     }
//     return vec3(0.0);
// }

vec3 ray_march(in vec3 ro, in vec3 rd)
{
    float total_distance_traveled = 0.0;
    

    for (int i = 0; i < NUMBER_OF_STEPS; ++i)
    {
        vec3 current_position = ro + total_distance_traveled * rd;

        float[2] distance_to_closest = map_the_world(current_position);

        if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
        {   
            int current_object_index = int(distance_to_closest[1]);
            WorldObject current_object = objects[current_object_index];
            vec3 normal = calculate_normal(current_position, current_object);
            vec3 direction_to_light = normalize(current_position - light_position);

            
            vec3 current_color;

            if(current_object.color.x == -2.0){
                current_color = normal * 0.5 + 0.5;
            }
            else{
                current_color = current_object.color;
                float diffuse_intensity = max(0.0, dot(normal, direction_to_light));
                current_color = current_color * (1.0 - current_object.diffuse_intensity) + current_color * diffuse_intensity * current_object.diffuse_intensity;
            }

            if (current_object.reflectivity > 0.0){
                float reflectivity = current_object.reflectivity;
                current_object.reflectivity = 0.0;
                vec3 reflection = ray_march2(current_position, reflect_ray(rd, normal), current_object_index);
                current_color = (reflection * reflectivity + (1.0 - reflectivity) * current_color);
            }

            if (current_object.transparency > 0.0){
                float transparency = current_object.transparency;
                current_object.transparency = 0.0;
                vec3 transparency_color = ray_march2(current_position, rd, current_object_index);
                current_color = transparency_color * transparency + (1.0 - transparency) * current_color;
            }
            return current_color * min(1.0, 20.0/total_distance_traveled);
        }

        if (total_distance_traveled > MAXIMUM_TRACE_DISTANCE)
        {
            break;
        }
        total_distance_traveled += distance_to_closest[0];
    }
    return vec3(0.0);
}


void main()
{
    float aspect = u_resolution.y / u_resolution.x;
    vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
    uv.y *= aspect;

    vec3 camera_position = u_camera_pos;
    vec3 ro = camera_position;
    vec3 rd = vec3(uv, 1.0);

    vec3 shaded_color = ray_march(ro, rd);

    frag_color = vec4(shaded_color, 1.0);
}

`;

let modVal = 17;
let multi = 1;
let multiChange = 0.01;
let delay = 1000/30;
let cameraPos = [3.0, -6.0, -3.5];

function main() {
  // Get A WebGL context
  var canvas = document.querySelector("#canvas");

  let drawScene = configureGL(canvas);
  addControls(canvas, drawScene);
  
  setInterval(() => {
    drawScene();
    multi += multiChange;
    multi = (20 + multi) % 40 - 20;
  }, delay)
}
function getMousePos(canvas, evt) {
  var rect = canvas.getBoundingClientRect(); // Step 2
  return [evt.clientX - rect.left, rect.bottom - evt.clientY ]
}

function addControls(canvas, drawScene) {
  // canvas.addEventListener('mousemove', function(evt) {
  //   mouse = getMousePos(canvas, evt);
  //   //console.log('Mouse position: ' + mouse[0] + ',' + mouse[1]);
  //   //drawScene();
  // });
  canvas.addEventListener('keydown', (e) => {
    if(e.key == 'ArrowUp'){
      cameraPos[2] += 1;
    }
    else if(e.key == 'ArrowDown'){
      cameraPos[2] -= 1;
    }
    else if(e.key == 'ArrowLeft'){
      cameraPos[0] -= 1;
    }
    else if(e.key == 'ArrowRight'){
      cameraPos[0] += 1;
    }
    else if(e.key == "Control"){
      cameraPos[1] -= 1;
    }
    else if(e.key == "Shift"){
      cameraPos[1] += 1;
    }
  });
}

class WorldObject {
  constructor(type, center, size, isNegated, hasShadow, reflectivity, transparency, diffuseIntensity, color) {
      this.type = type;
      this.center = center;
      this.size = size;
      this.isNegated = isNegated;
      this.hasShadow = hasShadow;
      this.reflectivity = reflectivity;
      this.transparency = transparency;
      this.diffuseIntensity = diffuseIntensity;
      this.color = color;
  }

  toArray() {
      return [
          ...this.center, 0.0,

          ...this.size, 0.0,

          ...this.color,

          this.type,
          this.isNegated,
          this.hasShadow,
          this.reflectivity,

          this.transparency,
          this.diffuseIntensity,
          0.0, 0.0, 0.0 // Padding to ensure proper alignment
      ];
  }
}

function configureGL(canvas){
  var gl = canvas.getContext("webgl2");
  if (!gl) {
    console.error("WebGL 2 is not available");
    return;
  }

  // Use our boilerplate utils to compile the shaders and link into a program
  var program = webglUtils.createProgramFromSources(gl, [vertexShaderSource, fragmentShaderSource]);

  // look up where the vertex data needs to go.
  var positionAttributeLocation = gl.getAttribLocation(program, "a_position");

  // look up uniform locations
  var resolutionUniformLocation = gl.getUniformLocation(program, "u_resolution");
  var zoomUniformLocation = gl.getUniformLocation(program, "u_mod_val");
  var cameraLocationUniformLocation = gl.getUniformLocation(program, "u_camera_pos");
  var numObjectsUniformLocation = gl.getUniformLocation(program, "u_numObjects");

  // Create a buffer and put a single pixel space rectangle in
  // it (2 triangles)
  // Create a buffer and put three 2d clip space points in it
  var positionBuffer = gl.createBuffer();

  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  var positions = [
    0, 0,
    window.innerWidth, 0,
    0, window.innerHeight,
    0, window.innerHeight,
    window.innerWidth, 0,
    window.innerWidth, window.innerHeight,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);


  const WorldObjects = [
    new WorldObject(5.0, [-10.0, -10.0, -10.0], [0.0, 1.0, 0.0], 0.0, 0.0, 0.4, 0.4, 0.6, [0.5, 0.5, 1.0]),
    new WorldObject(4.0, [10.0, -20.0, 10.0], [5.0, 11.0, 10.0], 0.0, 0.0, 0.2, 0.0, 0.6, [0.7764705882352941, 0.6431372549019608, 0.5549019607843137]),
    new WorldObject(4.0, [-10.0, -20.0, 10.0], [5.0, 11.0, 10.0], 0.0, 0.0, 0.2, 0.0, 0.6, [0.7764705882352941, 0.6431372549019608, 0.5549019607843137]),
    new WorldObject(4.0, [0.0, -20.0, 25.0], [15.0, 11.0, 5.0], 0.0, 0.0, 0.2, 0.0, 0.6, [0.7764705882352941, 0.6431372549019608, 0.5549019607843137]),
    new WorldObject(4.0, [0.0, -20.0, -5.0], [15.0, 11.0, 5.0], 0.0, 0.0, 0.2, 0.0, 0.6, [0.7764705882352941, 0.6431372549019608, 0.5549019607843137]),
    new WorldObject(4.0, [0.0, 0.0, 25.0], [15.0, 19.0, 1.0], 0.0, 0.0, 0.2, 0.0, 0.6, [1.0, 0.8352941176470589, 0.8039215686274509]),
    new WorldObject(4.0, [0.0, 0.0, -5.0], [15.0, 19.0, 1.0], 0.0, 0.0, 0.2, 0.0, 0.6, [1.0, 0.8352941176470589, 0.8039215686274509]),
    new WorldObject(4.0, [10.0, 0.0, 10.0], [1.0, 19.0, 14.0], 0.0, 0.0, 0.2, 0.0, 0.6, [1.0, 0.8352941176470589, 0.8039215686274509]),
    new WorldObject(4.0, [-10.0, 0.0, 10.0], [1.0, 19.0, 14.0], 0.0, 0.0, 0.2, 0.0, 0.6, [1.0, 0.8852941176470589, 0.8839215686274509]),
    new WorldObject(3.0, [0.0, 0.0, 0.0], [0.0, -1.0, 0.0], 0.0, 0.0, 0.2, 0.0, 0.0, [1, 0.9, 0.9]),
    new WorldObject(2.0, [0.0, -5.0, 12.0], [2.0, 2.0, 2.0], 0.0, 0.0, 0.4, 0.0, 0.4, [-2.0, -2.0, -2.0]),
  ];
//   let cameraPos = [3.0, -6.0, -3.5];

//   const WorldObjects = [];

//   for(let i = 0; i < 5; i++){
//     for(let j = 0; j < 5; j++){
//       WorldObjects.push(new WorldObject(2.0, [i * 3 - 10, j * 3 - 10, 0.0 ], [1.0, 1.0, 1.0], 0.0, 0.0, 0.0, 0.0, 0.0, [-2.0, -2.0, -2.0]));
//     }
//   }
  // Ensure your JavaScript code aligns with the updated shader expectations
  const numObjects = WorldObjects.length;
  const objectLength = WorldObjects[0].toArray().length;
  const data = new Array(objectLength * 32).fill(0.0);
  for (let i = 0; i < numObjects; i++) {
    let currentObject = WorldObjects[i].toArray();
    for(let j = 0; j < objectLength; j++){
      data[i * objectLength + j] = currentObject[j];
    }
  }
  // for (let i = 0; i < 32 - numObjects; i++) {
  //   data.push(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  // }

  console.log(new Float32Array(data));

  // Buffer creation and binding should align with WebGL expectations
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
  gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);

  // Ensure uniform block binding and other WebGL operations are correctly aligned
  const world_blockIndex = gl.getUniformBlockIndex(program, "WorldData");
  gl.uniformBlockBinding(program, world_blockIndex, 0);




  // Create a vertex array object (attribute state)
  var vao = gl.createVertexArray();

  // and make it the one we're currently working with
  gl.bindVertexArray(vao);

  // Turn on the attribute
  gl.enableVertexAttribArray(positionAttributeLocation);

  // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
  var size = 2;          // 2 components per iteration
  var type = gl.FLOAT;   // the data is 32bit floats
  var normalize = false; // don't normalize the data
  var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
  var offset = 0;        // start at the beginning of the buffer
  gl.vertexAttribPointer(positionAttributeLocation, size, type, normalize, stride, offset);

  gl.disable(gl.DITHER);


  console.log(gl.canvas.clientWidth, gl.canvas.clientHeight);

  function drawScene(){

    webglUtils.resizeCanvasToDisplaySize(gl.canvas);

    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Bind the attribute/buffer set we want.
    gl.bindVertexArray(vao);

    // Pass in the canvas resolution so we can convert from
    // pixels to clipspace in the shader
    gl.uniform2f(resolutionUniformLocation, gl.canvas.clientWidth, gl.canvas.clientHeight);
    gl.uniform2f(zoomUniformLocation, modVal, multi);
    gl.uniform3f(cameraLocationUniformLocation, cameraPos[0], cameraPos[1], cameraPos[2]);
    gl.uniform1i(numObjectsUniformLocation, numObjects);

    // draw
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 6;
    gl.drawArrays(primitiveType, offset, count);
  }

  return drawScene;
}

main();
