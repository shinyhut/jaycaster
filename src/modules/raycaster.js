const QUAD_1_LIMIT = radians(90);
const QUAD_2_LIMIT = radians(180);
const QUAD_3_LIMIT = radians(270);
const QUAD_4_LIMIT = radians(360);
const FIELD_OF_VIEW = radians(70);
const CELL_SIZE = 64;
const MIN_WALL_DISTANCE = 10.0;
const MAX_SPEED = 5.0;
const ACCEL = 0.2;
const DECEL = 0.1;
const MAX_TURN_SPEED = radians(2);
const TURN_ACCEL = radians(0.2);
const GAME_TICKS_PER_SECOND = 60;
const ANIMATION_DELAY = 1000 / GAME_TICKS_PER_SECOND;
const CACHE_WARMING_TIME = 5000;

function radians(degrees) {
    return degrees * (Math.PI / 180);
};

function normaliseAngle(radians) {
    radians = radians % QUAD_4_LIMIT;
    while (radians < 0) {
        radians += QUAD_4_LIMIT;
    }
    return radians;
}

export class Raycaster {
    constructor(canvas, map) {
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.msImageSmoothingEnabled = false;

        const distanceToProjectionPlane = (canvas.width / 2) / Math.tan(FIELD_OF_VIEW / 2);
        const imageData = ctx.createImageData(canvas.width, canvas.height);

        const display = {
            ctx,
            canvas,
            imageData,
            width: canvas.width,
            height: canvas.height,
            distanceToProjectionPlane,
            rayAngles: []
        };

        for (let sx = 0; sx < canvas.width; sx++) {
            const rayAngle = normaliseAngle(Math.atan((sx - canvas.width / 2) / distanceToProjectionPlane));
            display.rayAngles.push(rayAngle);
        }

        const world = new World(map.walls, map.floors, map.ceilings);         
        const player = new Player(map.startX, map.startY, map.initialHeading, world);
        const gameState = new GameState(player);
        for (const sprite of map.sprites) {
            gameState.addGameElement(sprite);
        }

        this._display = display;
        this._imageLoader = new ImageLoader(map.images);
        this._world = world;
        this._gameState = gameState;
        this._player = player;
    }
    
    fullScreen() {
        let canvas = this._display.canvas;
        if (canvas.requestFullscreen) {
            canvas.requestFullscreen();
        } else if (canvas.mozRequestFullScreen) {
            canvas.mozRequestFullScreen();
        } else if (canvas.webkitRequestFullscreen) {
            canvas.webkitRequestFullscreen();
        } else if (canvas.msRequestFullscreen) {
            canvas.msRequestFullscreen();
        }
    }
    
    run() {
        this._display.ctx.font = "bold 20px monospace";
        this._display.ctx.fillStyle = "green";
        this._display.ctx.fillText("Loading...", 10, 50);
        this._gameState.start();        
        window.requestAnimationFrame(this._render.bind(this));
    }
    
    _render(timestamp) {
        window.requestAnimationFrame(this._render.bind(this));

        if (!this._imageLoader.allLoaded) {
            return;
        }
        
        this._drawFloorsAndCeilings();
        const wallDistances = this._drawWalls();
        this._drawSprites(wallDistances);
        this._gameState.update(timestamp);
    }
    
    _drawFloorsAndCeilings() {
        const imageData = this._display.imageData;
        const startRayAngle = normaliseAngle(this._player.heading + this._display.rayAngles[0]);
        const relativeRayAngle = this._player.heading - startRayAngle;
        const endRayAngle = normaliseAngle(this._player.heading + this._display.rayAngles[this._display.width - 1]);

        for (let sy = 0; sy < this._display.height / 2; sy++) {
            const lineHeight = ((this._display.height / 2) - sy) * 2;
            const rayLength = ((CELL_SIZE / lineHeight) / Math.cos(relativeRayAngle)) * this._display.distanceToProjectionPlane;
            let worldX = this._player.x + (rayLength * Math.sin(startRayAngle));
            let worldY = this._player.y - (rayLength * Math.cos(startRayAngle));
            const endWorldX = this._player.x + (rayLength * Math.sin(endRayAngle));
            const endWorldY = this._player.y - (rayLength * Math.cos(endRayAngle));
            const dx = (endWorldX - worldX) / this._display.width;
            const dy = (endWorldY - worldY) / this._display.width;
            
            for (let sx = 0; sx < this._display.width; sx++) {
                if (!this._world.isInWorld(worldX, worldY)) {
                    worldX += dx;
                    worldY += dy;
                    continue;
                }
                const tx = Math.floor(worldX) % CELL_SIZE;
                const ty = Math.floor(worldY) % CELL_SIZE;
                const cellX = Math.floor(worldX / CELL_SIZE);
                const cellY = Math.floor(worldY / CELL_SIZE);
                const floorTexture = this._imageLoader.images[this._world.floors[cellY][cellX] - 1];
                const ceilingTexture = this._imageLoader.images[this._world.ceilings[cellY][cellX] - 1];
                const txOffset = (ty * CELL_SIZE + tx) * 4;
                let offset = (sy * this._display.width + sx) * 4;
                imageData.data[offset] = ceilingTexture.imageData.data[txOffset];
                imageData.data[offset + 1] = ceilingTexture.imageData.data[txOffset + 1];
                imageData.data[offset + 2] = ceilingTexture.imageData.data[txOffset + 2];
                imageData.data[offset + 3] = 255;
                offset = ((this._display.height - sy - 1) * this._display.width + sx) * 4;
                imageData.data[offset] = floorTexture.imageData.data[txOffset];
                imageData.data[offset + 1] = floorTexture.imageData.data[txOffset + 1];
                imageData.data[offset + 2] = floorTexture.imageData.data[txOffset + 2];
                imageData.data[offset + 3] = 255;
                worldX += dx;
                worldY += dy;
            }
        }

        if (!this._gameState.warmingCache) {
            this._display.ctx.putImageData(imageData, 0, 0);
        }
    }

    _drawWalls() {
        const wallDistances = [];
        for (let sx = 0; sx < this._display.width; sx++) {
            const rayAngle = normaliseAngle(this._player.heading + this._display.rayAngles[sx]);
            const relativeRayAngle = normaliseAngle(this._player.heading - rayAngle);
            const north = rayAngle <= QUAD_1_LIMIT || rayAngle >= QUAD_3_LIMIT;
            const west = rayAngle >= QUAD_2_LIMIT;

            let dy = north ? -(this._player.y % CELL_SIZE) : (CELL_SIZE - (this._player.y % CELL_SIZE));
            let dx = dy * Math.tan(rayAngle);
            const hRay = {
                x: this._player.x - dx,
                y: this._player.y + dy
            };
            dy = north ? -CELL_SIZE : CELL_SIZE;
            dx = dy * Math.tan(rayAngle);
            hRay.cellX = this._world.cell(hRay.x);
            hRay.cellY = this._world.cell(hRay.y);
            if (north) {
                hRay.cellY--;
            }

            while (this._world.isCellInWorld(hRay.cellX, hRay.cellY) && this._world.walls[hRay.cellY][hRay.cellX] === 0) {
                hRay.x -= dx;
                hRay.y += dy;
                hRay.cellX = this._world.cell(hRay.x);
                hRay.cellY = this._world.cell(hRay.y);
                if (north) {
                    hRay.cellY--;
                }
            }

            hRay.length = Math.sqrt(Math.pow((hRay.x - this._player.x), 2) + Math.pow((hRay.y - this._player.y), 2));
            
            dx = west ? -(this._player.x % CELL_SIZE) : (CELL_SIZE - (this._player.x % CELL_SIZE));
            dy = dx / Math.tan(rayAngle);
            const vRay = {
                x: this._player.x + dx,
                y: this._player.y - dy
            };
            dx = west ? -CELL_SIZE : CELL_SIZE;
            dy = dx / Math.tan(rayAngle);
            vRay.cellX = this._world.cell(vRay.x);
            vRay.cellY = this._world.cell(vRay.y);
            if (west) {
                vRay.cellX--;
            }

            while (this._world.isCellInWorld(vRay.cellX, vRay.cellY) && this._world.walls[vRay.cellY][vRay.cellX] === 0) {
                vRay.x += dx;
                vRay.y -= dy;
                vRay.cellX = this._world.cell(vRay.x);
                vRay.cellY = this._world.cell(vRay.y);
                if (west) {
                    vRay.cellX--;
                }
            }

            vRay.length = Math.sqrt(Math.pow((vRay.x - this._player.x), 2) + Math.pow((vRay.y - this._player.y), 2));

            let rayLength;
            let tx;
            let texture;
            if (vRay.length < hRay.length) {
                rayLength = vRay.length;
                tx = Math.floor(vRay.y % CELL_SIZE);
                if (west) {
                    tx = CELL_SIZE - tx - 1;
                }
                texture = this._imageLoader.images[this._world.walls[vRay.cellY][vRay.cellX] - 1].image;
            } else {
                rayLength = hRay.length;
                tx = Math.floor(hRay.x % CELL_SIZE);
                if (!north) {
                    tx = CELL_SIZE - tx - 1;
                }
                texture = this._imageLoader.images[this._world.walls[hRay.cellY][hRay.cellX] - 1].image;
            }

            const perpRayLength = rayLength * Math.cos(relativeRayAngle);
            const lineHeight = (CELL_SIZE / perpRayLength) * this._display.distanceToProjectionPlane;
            const wallTop = Math.floor((this._display.height - lineHeight) / 2);
            wallDistances.push(perpRayLength);
            
            if (!this._gameState.warmingCache) {
                this._display.ctx.drawImage(texture, tx, 0, 1, CELL_SIZE, sx, wallTop, 1, lineHeight);
            }            
        }
        return wallDistances;
    }

    _drawSprites(wallDistances) {
        const furthestWall = Math.max(...wallDistances);
        const sprites = this._gameState.sprites;
        const visibleSprites = []

        for (const sprite of sprites) {
            const dx = sprite.x - this._player.x;
            const dy = this._player.y - sprite.y;
            const angle = normaliseAngle(Math.atan2(dx, dy) - this._player.heading);
            if (!(angle >= QUAD_1_LIMIT && angle <= QUAD_3_LIMIT)) {
                const distance = Math.sqrt(Math.pow((sprite.x - this._player.x), 2) + Math.pow((this._player.y - sprite.y), 2)) * Math.cos(angle);
                if (distance < furthestWall) {
                    visibleSprites.push({sprite, angle, distance});
                }
            }
        }
        
        visibleSprites.sort((a, b) => b.distance - a.distance);
        
        for (const s of visibleSprites) {
            const sprite = s.sprite;
            const distance = s.distance;
            const angle = s.angle;
            const image = this._imageLoader.images[sprite.image].image;
            const height = Math.round((image.height / distance) * this._display.distanceToProjectionPlane);
            const scale = image.height / height;
            const width = image.width / scale;
            const sx = Math.round(Math.tan(angle) * this._display.distanceToProjectionPlane + (this._display.width / 2) - width / 2);
            const sy = Math.round((this._display.height - height) / 2);
            for (let x = sx; x < sx + width; x++) {
                if (x < 0 || x > this._display.width - 1) {
                    continue;
                }
                if (distance < wallDistances[x]) {
                    let tx = Math.round((x - sx) * scale);
                    if (!this._gameState.warmingCache) {
                        this._display.ctx.drawImage(image, tx, 0, 1, image.height, x, sy, 1, height);
                    }
                }
            }
        }
    }
}

class World {
    constructor(walls, floors, ceilings) {
        this.walls = walls;
        this.floors = floors;
        this.ceilings = ceilings;
        this.horizontalCells = walls[0].length;
        this.verticalCells = walls.length;
        this.width = walls[0].length * CELL_SIZE;
        this.height = walls.length * CELL_SIZE;
    }

    isInWorld(x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }
    
    isCellInWorld(cellX, cellY) {
        return cellX >= 0 && cellY >= 0 && cellX < this.horizontalCells && cellY < this.verticalCells;
    }

    cell(worldX) {
        return Math.floor(worldX / CELL_SIZE);
    }
}

class ImageLoader {    
    constructor(uris) {
        this.images = [];
        for (const uri of uris) {
            const image = {
                loaded: false,
                image: new Image()
            };
            image.image.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext("2d");
                ctx.drawImage(image.image, 0, 0);
                image.imageData = ctx.getImageData(0, 0, image.image.width, image.image.height);
                image.loaded = true;
            }
            image.image.src = uri;
            this.images.push(image);
        }
    }

    get allLoaded() {
        return this.images.every(t => t.loaded)
    }
}


class KeyTracker {
    constructor() {
        this.forward = false;
        this.backward = false;
        this.left = false;
        this.right = false;

        let keydown = function (event) {
            event.preventDefault();
            switch (event.key) {
                case "ArrowLeft":
                case "Left":
                    this.left = true;
                    break;
                case "ArrowRight":
                case "Right":
                    this.right = true;
                    break;
                case "ArrowUp":
                case "Up":
                    this.forward = true;
                    break;
                case "ArrowDown":
                case "Down":
                    this.backward = true;
                    break;
            }
        };

        let keyup = function (event) {
            event.preventDefault();
            switch (event.key) {
                case "ArrowLeft":
                case "Left":
                    this.left = false;
                    break;
                case "ArrowRight":
                case "Right":
                    this.right = false;
                    break;
                case "ArrowUp":
                case "Up":
                    this.forward = false;
                    break;
                case "ArrowDown":
                case "Down":
                    this.backward = false;
                    break;
            }
        };

        window.addEventListener("keydown", keydown.bind(this));
        window.addEventListener("keyup", keyup.bind(this));
    }
}

class GameState {
    constructor(player) {
        this._player = player;
        this._gameElements = [];
        this.addGameElement(player);
    }
    
    start() {
        this.warmingCache = true;
        this._cacheWarmingTimeout = new Date().getTime() + CACHE_WARMING_TIME;
    }

    update(timestamp) {
        let ticks;
        if (this._lastRun === undefined) {
            ticks = 1;
        } else {
            const delta = timestamp - this._lastRun;
            ticks = delta / ANIMATION_DELAY;
        }
        this._lastRun = timestamp;
        for (const element of this._gameElements) {
            if (element.animate) {
                element.animate(ticks);
            }
        }
        if (this.warmingCache) {
            this._player.keys.forward = true;
            this._player.keys.left = true;
            const now = new Date().getTime();
            if (now > this._cacheWarmingTimeout) {
                this.warmingCache = false;
                this._player.keys.forward = false;
                this._player.keys.left = false;
                for (const element of this._gameElements) {
                    if (element.reset) {
                        element.reset();
                    }
                }
            }
        }
    }

    addGameElement(element) {
        this._gameElements.push(element);
    }

    get sprites() {
        return this._gameElements.filter(element => element.image);
    }
}

class Projectile {
    constructor(x, y, heading, speed, world) {
        this.x = x;
        this.y = y;
        this.heading = heading;
        this._speed = speed;
        this._world = world;
        this._initialX = x;
        this._initialY = y;
        this._initialHeading = heading;
        this._initialSpeed = speed;
    }

    animate(ticks) {
        const dx = Math.sin(this.heading);
        const dy = Math.cos(this.heading);
        const speed = this._speed * ticks;
        const wallCheck = speed > 0 ? MIN_WALL_DISTANCE : speed < 0 ? -MIN_WALL_DISTANCE : 0;
        const wx = this._world.cell(this.x + wallCheck * dx);
        const wy = this._world.cell(this.y - wallCheck * dy);
        const px = this.x + speed * dx;
        const py = this.y - speed * dy;
        const pcx = this._world.cell(px);
        const pcy = this._world.cell(py);
        if (this._world.walls[wy][wx] !== 0 || this._world.walls[pcy][pcx] !== 0) {
            this._speed = 0.0;
            return false;
        } else {
            this.x = px;
            this.y = py;
            return true;
        }
    }
    
    reset() {
        this.x = this._initialX;
        this.y = this._initialY;
        this.heading = this._initialHeading;
        this._speed = this._initialSpeed;
    }
}

class Player extends Projectile {
    constructor(x, y, heading, world) {
        super(x, y, heading, 0.0, world);
        this._turnSpeed = 0.0;
        this._world = world;
        this.keys = new KeyTracker();
    }
    
    animate(ticks) {
        const turnSpeed = this._turnSpeed * ticks;
        const turnAccel = TURN_ACCEL * ticks;
        const hitWall = !super.animate(ticks);

        this.heading = normaliseAngle(this.heading + turnSpeed);

        if (!hitWall) {
            const accel = ACCEL * ticks;
            const decel = DECEL * ticks;
            
            if (this.keys.forward) {
                if (this._speed < 0.0) {
                    this._speed = 0.0;
                }
                if (this._speed <= MAX_SPEED) {
                    this._speed += accel;
                }
            } else if (this.keys.backward) {
                if (this._speed > 0.0) {
                    this._speed = 0.0;
                }
                if (Math.abs(this._speed) <= MAX_SPEED) {
                    this._speed -= accel;
                }
            } else {
                if (this._speed > 0.0) {
                    this._speed -= decel;
                    if (this._speed < 0.0) {
                        this._speed = 0.0;
                    }
                }
                else if (this._speed < 0.0) {
                    this._speed += decel;
                    if (this._speed > 0.0) {
                        this._speed = 0.0;
                    }
                }
            }
        }

        if (this.keys.left) {
            if (Math.abs(this._turnSpeed) < MAX_TURN_SPEED) {
                this._turnSpeed -= turnAccel;
            }
        } else if (this._turnSpeed < 0.0) {
            this._turnSpeed = 0.0;
        }

        if (this.keys.right) {
            if (this._turnSpeed < MAX_TURN_SPEED) {
                this._turnSpeed += turnAccel;
            }
        } else if (this._turnSpeed > 0.0) {
            this._turnSpeed = 0.0;
        }
    }
    
    reset() {
        super.reset();
        this._turnSpeed = 0.0;
    }
}