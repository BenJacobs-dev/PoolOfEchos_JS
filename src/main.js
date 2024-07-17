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

const int OBJECT_COUNT_MAX = 16;
const int OBJECT_COUNT = 11;

const vec3 light_position = vec3(15.0, 15.0, -5.0);
const int NUMBER_OF_STEPS = 256;
const float MINIMUM_HIT_DISTANCE = 0.01;
const float MAXIMUM_TRACE_DISTANCE = 10000.0;

struct WorldObject
{
    float type;
    vec3 center;
    vec3 size;
    float is_negated;
    float has_shadow;
    float reflectivity;
    float transparency;
    float diffuse_intensity;
    vec3 color;
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

    return 0.0;
}


float[2] map_the_world(in vec3 p, in WorldObject[OBJECT_COUNT_MAX] objects)
{

    float[2] min_dist;
    min_dist[0] = 100000.0;
    min_dist[1] = -1.0;
    float cur_dist = 0.0;
    for (int i = 0; i < OBJECT_COUNT; ++i)
    {
        cur_dist = map_the_object(p, objects[i]);
        if (cur_dist < min_dist[0]){
            min_dist[0] = cur_dist;
            min_dist[1] = float(i);
        }
    }

    return min_dist;
}

float[2] map_the_world_skip(in vec3 p, in WorldObject[OBJECT_COUNT_MAX] objects, in int skip_object)
{

    float[2] min_dist;
    min_dist[0] = 100000.0;
    min_dist[1] = -1.0;
    float cur_dist = 0.0;
    for (int i = 0; i < OBJECT_COUNT; ++i)
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

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Build World Here
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// struct WorldObject
// {
//     int type;
//     vec3 center;
//     vec3 size;
//     bool is_negated;
//     bool has_shadow;
//     float reflectivity;
//     float transparency;
//     float diffuse_intensity;
//     vec3 color;
// };

WorldObject[OBJECT_COUNT_MAX] create_world(in float multi)
{
    WorldObject world[OBJECT_COUNT_MAX];
    // world[0] = WorldObject(2, vec3(0.0), vec3(1.0), 0.0, 0.0, 0.2, 0.3, 0.4, vec3(1.0, 0.0, 0.0));
    // world[1] = WorldObject(5, vec3(0.0, -10.0, 0.0), vec3(0.0, 1.0, 0.0), 0.0, 0.0, 0.4, 0.0, 0.0, vec3(-2.0));
    // world[2] = WorldObject(1, vec3(-3.0+multi/5.0, 1.0, 3.0), vec3(1.0), 0.0, 0.0, 0.6, 0.0, 0.0, vec3(-2.0));
    // world[3] = WorldObject(4, vec3(1.0, 5.0, 1.0), vec3(1.5), 0.0, 0.0, 0.0, 0.0, 0.0, vec3(-2.0));
    // world[4] = WorldObject(4, vec3(-2.0, -9.0, 20.0), vec3(3.0), 0.0, 0.0, 0.0, 0.0, 0.0, vec3(-2.0));
    // world[5] = WorldObject(4, vec3(0.0, -6.0, -10.5), vec3(2.0), 0.0, 0.0, 0.90, 0.0, 0.0, vec3(-2.0));
    // world[6] = WorldObject(4, vec3(0.0, -6.0, -18.5), vec3(2.0), 0.0, 0.0, 0.7, 0.0, 0.0, vec3(-2.0));

    float depth = 10.0;
    world[0] = WorldObject(5.0, vec3(-10.0), vec3(0.0, 1.0, 0.0), 0.0, 0.0, 0.4, 0.4, 0.6, vec3(0.5, 0.5, 1.0));
    world[1] = WorldObject(4.0, vec3(10.0, -10.0-depth, 10.0), vec3(5.0, 1.0+depth, 10.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(0.7764705882352941, 0.6431372549019608, 0.5549019607843137));
    world[2] = WorldObject(4.0, vec3(-10.0, -10.0-depth, 10.0), vec3(5.0, 1.0+depth, 10.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(0.7764705882352941, 0.6431372549019608, 0.5549019607843137));
    world[3] = WorldObject(4.0, vec3(0.0, -10.0-depth, 25.0), vec3(15.0, 1.0+depth, 5.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(0.7764705882352941, 0.6431372549019608, 0.5549019607843137));
    world[4] = WorldObject(4.0, vec3(0.0, -10.0-depth, -5.0), vec3(15.0, 1.0+depth, 5.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(0.7764705882352941, 0.6431372549019608, 0.5549019607843137));
    world[5] = WorldObject(4.0, vec3(0.0, 0.0, 25.0), vec3(15.0, 9.0, 1.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(1.0, 0.8352941176470589, 0.8039215686274509));
    world[6] = WorldObject(4.0, vec3(0.0, 0.0, -5.0), vec3(15.0, 9.0, 1.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(1.0, 0.8352941176470589, 0.8039215686274509));
    world[7] = WorldObject(4.0, vec3(10.0, 0.0, 10.0), vec3(1.0, 9.0, 14.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(1.0, 0.8352941176470589, 0.8039215686274509));
    world[8] = WorldObject(4.0, vec3(-10.0, 0.0, 10.0), vec3(1.0, 9.0, 14.0), 0.0, 0.0, 0.2, 0.0, 0.6, vec3(1.0, 0.8852941176470589, 0.8839215686274509));
    world[9] = WorldObject(3.0, vec3(0.0, 0.0, 0.0), vec3(0.0, -1.0, 0.0), 0.0, 0.0, 0.2, 0.0, 0.0, vec3(1, 0.9, 0.9));
    world[10] = WorldObject(2.0, vec3(0.0, -5.0, 12.0), vec3(2.0), 0.0, 0.0, 0.4, 0.0, 0.4, vec3(-2.0));
    return world;
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

vec3 ray_march3(in vec3 ro, in vec3 rd, WorldObject[OBJECT_COUNT_MAX] world, in int skip_object)
{
    float total_distance_traveled = 0.0;

    for (int i = 0; i < NUMBER_OF_STEPS; ++i)
    {
        
        vec3 current_position = ro + total_distance_traveled * rd;

        float[2] distance_to_closest = map_the_world_skip(current_position, world, skip_object);

        if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
        {   
            WorldObject current_object = world[int(distance_to_closest[1])];
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

vec3 ray_march2(in vec3 ro, in vec3 rd, WorldObject[OBJECT_COUNT_MAX] world, in int skip_object)
{
    float total_distance_traveled = 0.0;

    for (int i = 0; i < NUMBER_OF_STEPS; ++i)
    {
        vec3 current_position = ro + total_distance_traveled * rd;

        float[2] distance_to_closest = map_the_world_skip(current_position, world, skip_object);

        if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
        {   
            int current_object_index = int(distance_to_closest[1]);
            WorldObject current_object = world[current_object_index];
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
                vec3 reflection = ray_march3(current_position, reflect_ray(rd, normal), world, current_object_index);
                current_color = (reflection * reflectivity + (1.0 - reflectivity) * current_color);
            }

            if (current_object.transparency > 0.0){
                float transparency = current_object.transparency;
                current_object.transparency = 0.0;
                vec3 transparency_color = ray_march3(current_position, rd, world, current_object_index);
                current_color = transparency_color * transparency + (1.0 - transparency) * current_color;
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

vec3 ray_march(in vec3 ro, in vec3 rd, WorldObject[OBJECT_COUNT_MAX] world)
{
    float total_distance_traveled = 0.0;
    

    for (int i = 0; i < NUMBER_OF_STEPS; ++i)
    {
        vec3 current_position = ro + total_distance_traveled * rd;

        float[2] distance_to_closest = map_the_world(current_position, world);

        if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
        {   
            int current_object_index = int(distance_to_closest[1]);
            WorldObject current_object = world[current_object_index];
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
                vec3 reflection = ray_march2(current_position, reflect_ray(rd, normal), world, current_object_index);
                current_color = (reflection * reflectivity + (1.0 - reflectivity) * current_color);
            }

            if (current_object.transparency > 0.0){
                float transparency = current_object.transparency;
                current_object.transparency = 0.0;
                vec3 transparency_color = ray_march2(current_position, rd, world, current_object_index);
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

// vec3 ray_march(in vec3 ro, in vec3 rd, WorldObject[OBJECT_COUNT_MAX] world)
// {
//     vec3 cur_vec3s[3];
//     cur_vec3s[0] = vec3(0.0);
//     cur_vec3s[1] = ro;
//     cur_vec3s[2] = rd;

//     int depth = 3;

//     for (int i = 0; i < depth; ++i)
//     {
//         if(ray_march_depth(cur_vec3s, world, i)){
//             return cur_vec3s[0];
//         }
//     }
//     return vec3(0.0);
// }

// int ray_march_depth(in vec3[3] cur_vec3s, WorldObject[OBJECT_COUNT_MAX] world, in int depth)
// {
//     vec3 ro = cur_vec3s[1];
//     vec3 rd = cur_vec3s[2];
//     float total_distance_traveled = 0.0;
//     const int NUMBER_OF_STEPS = 32;
//     const float MINIMUM_HIT_DISTANCE = 0.01;
//     const float MAXIMUM_TRACE_DISTANCE = 10000.0;

//     for (int i = 0; i < NUMBER_OF_STEPS; ++i)
//     {
//         vec3 current_position = ro + total_distance_traveled * rd;

//         float[2] distance_to_closest = map_the_world(current_position, world);

//         if (distance_to_closest[0] < MINIMUM_HIT_DISTANCE) 
//         {   
//             int current_object_index = int(distance_to_closest[1]);
//             WorldObject current_object = world[current_object_index];
//             vec3 normal = calculate_normal(current_position, current_object);
//             
//             vec3 direction_to_light = normalize(current_position - light_position);

            
//             vec3 current_color = cur_vec3s[0];

//             // float diffuse_intensity = max(0.0, dot(normal, direction_to_light));

//             if (current_object.reflectivity > 0.0){
//                 float reflectivity = current_object.reflectivity;
//                 current_object.reflectivity = 0.0;
//                 vec3 reflection = ray_march2(current_position, reflect_ray(rd, normal), world, current_object_index);
//                 current_color = (reflection * reflectivity + (1.0 - reflectivity) * current_color);
//                 cur_vec3s[0] = current_color;
//                 cur_vec3s[1] = current_position;
//                 cur_vec3s[2] = reflect_ray(rd, normal);
//                 return 0;
//             }

//             if (current_object.transparency > 0.0){
//                 float transparency = current_object.transparency;
//                 current_object.transparency = 0.0;
//                 vec3 transparency_color = ray_march2(current_position, rd, world, current_object_index);
//                 current_color = transparency_color * transparency + (1.0 - transparency) * current_color;
//                 cur_vec3s[0] = current_color;
//                 cur_vec3s[1] = current_position;
//                 cur_vec3s[2] = rd;
//                 return 0;
//             }
//             cur_vec3s[0] = normal * 0.5 + 0.5;
//             return 1;
//         }

//         if (total_distance_traveled > MAXIMUM_TRACE_DISTANCE)
//         {
//             break;
//         }
//         total_distance_traveled += distance_to_closest[0];
//     }
//     return 1;
// }


void main()
{
    float aspect = u_resolution.y / u_resolution.x;
    vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
    uv.y *= aspect;

    vec3 camera_position = u_camera_pos;
    vec3 ro = camera_position;
    vec3 rd = vec3(uv, 1.0);

    WorldObject[] world = create_world(u_mod_val.y);

    vec3 shaded_color = ray_march(ro, rd, world);

    frag_color = vec4(shaded_color, 1.0);
}

`;

let modVal = 17;
let multi = 1;
let multiChange = 0.01;
let delay = 10000000/30;
let cameraPos = [0.0, 0.0, -3.5];

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

function configureGL(canvas){
  var gl = canvas.getContext("webgl2");
  if (!gl) {
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

    // draw
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 6;
    gl.drawArrays(primitiveType, offset, count);
  }

  return drawScene;
}

main();
