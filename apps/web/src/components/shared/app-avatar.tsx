"use client";

import { Style, Avatar } from '@dicebear/core';
import loopsdefinition from '@dicebear/styles/loops.json' with { type: 'json' };
import squirclesdefinition from '@dicebear/styles/squircles.json' with { type: 'json' };
import { useMemo } from 'react';

export const userAvatar = ({ seed }: { seed: string }) => {
    const style = new Style(loopsdefinition);
    return useMemo(() => {
        const avatar = new Avatar(style, {
            animationProbability: 0.5,
            animationVariant: 'medium',
            flip: "both",
            seed: seed,
        }).toDataUri();
        return avatar;
    }, [seed]);
}

export const orgAvatar = ({ seed }: { seed: string }) => {
    const style = new Style(squirclesdefinition);
    return useMemo(() => {
        const avatar = new Avatar(style, {
            animationProbability: 0.5,
            animationVariant: 'medium',
            flip: "both",
            seed: seed,
        }).toDataUri();
        return avatar;
    }, [seed]);
}