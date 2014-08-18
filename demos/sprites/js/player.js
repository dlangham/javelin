javelin.prefab('player', {
    components: {
        'demo.controls': {
            speed: 5
        },
        'pixi.renderable': {
            orientation: 90 //original image was not facing "up"
        },
        'pixi.sprite': {
            //atlasPath: '/demos/shared/assets/robot/robot.atlas.json',
            imagePath: '/demos/shared/assets/robot/robowalk00.png'
        }
//        'spriteAnimator2d': {
//            animations: {
//                'walk': {
//                    atlasPath: '/demos/shared/assets/robot/robot.atlas.json',
//                    loop: true,
//                    time: 500,
//                    frames: [
//                        'robowalk00.png',
//                        'robowalk01.png',
//                        'robowalk02.png',
//                        'robowalk03.png',
//                        'robowalk04.png',
//                        'robowalk05.png',
//                        'robowalk06.png',
//                        'robowalk07.png',
//                        'robowalk08.png',
//                        'robowalk09.png',
//                        'robowalk10.png',
//                        'robowalk11.png',
//                        'robowalk12.png',
//                        'robowalk13.png',
//                        'robowalk14.png',
//                        'robowalk15.png',
//                        'robowalk16.png',
//                        'robowalk17.png',
//                        'robowalk18.png'
//                    ]
//                }
//            }
//        }
    }
});
