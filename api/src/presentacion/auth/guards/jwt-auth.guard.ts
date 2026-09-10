import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Aplica esto a cualquier endpoint que requiera estar logueado. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
