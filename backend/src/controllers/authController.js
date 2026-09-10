import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

function sanitize(user) {
  return {
    id: user._id,
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new ApiError(400, 'Please enter your username and password.');
  }

  const user = await User.findOne({ username: username.trim().toLowerCase() });
  if (!user || !user.active) {
    throw new ApiError(401, 'Incorrect username or password.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, 'Incorrect username or password.');
  }

  const token = signToken(user);
  res.json({ success: true, data: { token, user: sanitize(user) } });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: sanitize(req.user) });
});

export const register = asyncHandler(async (req, res) => {
  // Only used to create the very first admin account, or by an existing admin.
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) {
    throw new ApiError(400, 'Username, password and name are required.');
  }
  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters.');
  }

  const existingCount = await User.countDocuments();
  if (existingCount > 0) {
    // Once at least one user exists, only an authenticated admin may create more.
    if (!req.user || req.user.role !== 'admin') {
      throw new ApiError(403, 'Only an administrator can create new users.');
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    username: username.trim().toLowerCase(),
    passwordHash,
    name,
    role: existingCount === 0 ? 'admin' : role || 'cashier',
  });

  const token = signToken(user);
  res.status(201).json({ success: true, data: { token, user: sanitize(user) } });
});
